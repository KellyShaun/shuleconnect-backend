const { Pool } = require('pg');
const moment = require('moment');

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

// SMS configuration (Africa's Talking)
const sendSMS = async (phone, message) => {
    console.log(`[SMS] To: ${phone}, Message: ${message}`);
    // Integrate Africa's Talking or Twilio here
    return { success: true, message_id: Date.now() };
};

// Email configuration
const sendEmail = async (email, subject, message) => {
    console.log(`[Email] To: ${email}, Subject: ${subject}`);
    return { success: true };
};

// ==================== CONVERSATIONS ====================

// Get or create conversation between two users
async function getOrCreateConversation(req, res) {
    const { user_id } = req.params;
    const currentUserId = req.user.id;
    
    try {
        // Check if conversation exists
        const existing = await pool.query(`
            SELECT c.id, c.conversation_name
            FROM conversations c
            JOIN conversation_participants cp1 ON c.id = cp1.conversation_id
            JOIN conversation_participants cp2 ON c.id = cp2.conversation_id
            WHERE c.conversation_type = 'individual'
                AND cp1.user_id = $1
                AND cp2.user_id = $2
                AND c.is_active = true
        `, [currentUserId, user_id]);
        
        if (existing.rows.length > 0) {
            return res.json(existing.rows[0]);
        }
        
        // Create new conversation
        const convResult = await pool.query(`
            INSERT INTO conversations (school_id, conversation_type, created_by)
            VALUES ($1, 'individual', $2)
            RETURNING id
        `, [req.user.school_id, currentUserId]);
        
        const conversationId = convResult.rows[0].id;
        
        // Add participants
        await pool.query(`
            INSERT INTO conversation_participants (conversation_id, user_id)
            VALUES ($1, $2), ($1, $3)
        `, [conversationId, currentUserId, user_id]);
        
        res.json({ id: conversationId, conversation_name: null });
    } catch (error) {
        console.error('Error creating conversation:', error);
        res.status(500).json({ error: error.message });
    }
}

// Get user's conversations
async function getUserConversations(req, res) {
    try {
        const result = await pool.query(`
            SELECT DISTINCT
                c.id,
                c.conversation_type,
                c.conversation_name,
                u.id as other_user_id,
                u.first_name as other_first_name,
                u.last_name as other_last_name,
                u.role as other_role,
                u.profile_photo_url,
                (
                    SELECT content FROM messages m2
                    WHERE m2.conversation_id = c.id
                    ORDER BY m2.created_at DESC
                    LIMIT 1
                ) as last_message,
                (
                    SELECT created_at FROM messages m2
                    WHERE m2.conversation_id = c.id
                    ORDER BY m2.created_at DESC
                    LIMIT 1
                ) as last_message_time,
                (
                    SELECT COUNT(*) FROM messages m2
                    WHERE m2.conversation_id = c.id
                        AND m2.sender_id != $1
                        AND m2.is_read = false
                ) as unread_count
            FROM conversations c
            JOIN conversation_participants cp ON c.id = cp.conversation_id
            LEFT JOIN conversation_participants cp2 ON c.id = cp2.conversation_id AND cp2.user_id != $1
            LEFT JOIN users u ON cp2.user_id = u.id
            WHERE cp.user_id = $1 AND c.is_active = true
            ORDER BY last_message_time DESC NULLS LAST
        `, [req.user.id]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching conversations:', error);
        res.status(500).json({ error: error.message });
    }
}

// Get conversation messages
async function getConversationMessages(req, res) {
    const { conversation_id } = req.params;
    const { limit = 50, before } = req.query;
    
    try {
        let query = `
            SELECT m.*, u.first_name, u.last_name, u.role, u.profile_photo_url,
                   COALESCE(
                       (SELECT json_agg(jsonb_build_object('reaction', reaction, 'user_id', user_id))
                        FROM message_reactions mr
                        WHERE mr.message_id = m.id),
                       '[]'
                   ) as reactions
            FROM messages m
            JOIN users u ON m.sender_id = u.id
            WHERE m.conversation_id = $1 AND m.is_deleted = false
        `;
        
        const params = [conversation_id];
        
        if (before) {
            query += ` AND m.created_at < $2`;
            params.push(before);
        }
        
        query += ` ORDER BY m.created_at DESC LIMIT $${params.length + 1}`;
        params.push(limit);
        
        const result = await pool.query(query, params);
        
        // Mark messages as read
        await pool.query(`
            UPDATE messages SET is_read = true
            WHERE conversation_id = $1 AND sender_id != $2 AND is_read = false
        `, [conversation_id, req.user.id]);
        
        res.json(result.rows.reverse());
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ error: error.message });
    }
}

// Send message
async function sendMessage(req, res) {
    const { conversation_id, content, message_type, media_url, reply_to_id } = req.body;
    
    try {
        const result = await pool.query(`
            INSERT INTO messages (conversation_id, sender_id, content, message_type, media_url, reply_to_id)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `, [conversation_id, req.user.id, content, message_type || 'text', media_url, reply_to_id]);
        
        const message = result.rows[0];
        
        // Get conversation participants for notifications
        const participants = await pool.query(`
            SELECT user_id FROM conversation_participants
            WHERE conversation_id = $1 AND user_id != $2
        `, [conversation_id, req.user.id]);
        
        // Send real-time notification via Socket.io
        for (const participant of participants.rows) {
            req.io.to(`user_${participant.user_id}`).emit('new_message', {
                conversation_id,
                message: message
            });
        }
        
        res.status(201).json(message);
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: error.message });
    }
}

// Add reaction to message
async function addReaction(req, res) {
    const { message_id, reaction } = req.body;
    
    try {
        await pool.query(`
            INSERT INTO message_reactions (message_id, user_id, reaction)
            VALUES ($1, $2, $3)
            ON CONFLICT (message_id, user_id) DO UPDATE SET reaction = $3
        `, [message_id, req.user.id, reaction]);
        
        res.json({ message: 'Reaction added' });
    } catch (error) {
        console.error('Error adding reaction:', error);
        res.status(500).json({ error: error.message });
    }
}

// ==================== GROUPS ====================

// Create group
async function createGroup(req, res) {
    const { group_name, group_type, description, member_ids } = req.body;
    
    try {
        const result = await pool.query(`
            INSERT INTO groups (school_id, group_name, group_type, description, created_by)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id
        `, [req.user.school_id, group_name, group_type, description, req.user.id]);
        
        const groupId = result.rows[0].id;
        
        // Add creator as admin
        await pool.query(`
            INSERT INTO group_members (group_id, user_id, role)
            VALUES ($1, $2, 'admin')
        `, [groupId, req.user.id]);
        
        // Add other members
        for (const memberId of member_ids) {
            await pool.query(`
                INSERT INTO group_members (group_id, user_id, role)
                VALUES ($1, $2, 'member')
            `, [groupId, memberId]);
        }
        
        // Create conversation for the group
        const convResult = await pool.query(`
            INSERT INTO conversations (school_id, conversation_type, conversation_name, created_by)
            VALUES ($1, 'group', $2, $3)
            RETURNING id
        `, [req.user.school_id, group_name, req.user.id]);
        
        const conversationId = convResult.rows[0].id;
        
        // Add all members to conversation
        const allMemberIds = [req.user.id, ...member_ids];
        for (const memberId of allMemberIds) {
            await pool.query(`
                INSERT INTO conversation_participants (conversation_id, user_id)
                VALUES ($1, $2)
            `, [conversationId, memberId]);
        }
        
        res.status(201).json({ id: groupId, conversation_id: conversationId });
    } catch (error) {
        console.error('Error creating group:', error);
        res.status(500).json({ error: error.message });
    }
}

// Get user's groups
async function getUserGroups(req, res) {
    try {
        const result = await pool.query(`
            SELECT g.*, 
                   (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count,
                   (SELECT content FROM messages m 
                    JOIN conversations c ON c.conversation_name = g.group_name
                    WHERE c.conversation_type = 'group'
                    ORDER BY m.created_at DESC LIMIT 1) as last_message
            FROM groups g
            JOIN group_members gm ON g.id = gm.group_id
            WHERE gm.user_id = $1 AND g.is_active = true
            ORDER BY g.created_at DESC
        `, [req.user.id]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching groups:', error);
        res.status(500).json({ error: error.message });
    }
}

// ==================== ANNOUNCEMENTS ====================

// Create announcement
async function createAnnouncement(req, res) {
    const { title, content, target_audience, priority, schedule_date } = req.body;
    
    try {
        const result = await pool.query(`
            INSERT INTO announcements (
                school_id, title, content, target_audience, priority, 
                status, created_by, published_at
            ) VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)
            RETURNING id
        `, [req.user.school_id, title, content, target_audience, priority, 
            req.user.id, schedule_date || new Date()]);
        
        res.status(201).json({ id: result.rows[0].id, message: 'Announcement created, pending approval' });
    } catch (error) {
        console.error('Error creating announcement:', error);
        res.status(500).json({ error: error.message });
    }
}

// Get announcements
async function getAnnouncements(req, res) {
    try {
        const result = await pool.query(`
            SELECT a.*, u.first_name, u.last_name,
                   (SELECT COUNT(*) FROM announcement_reads WHERE announcement_id = a.id AND user_id = $1) as is_read
            FROM announcements a
            JOIN users u ON a.created_by = u.id
            WHERE a.school_id = $2 
                AND a.status = 'published'
                AND (a.expires_at IS NULL OR a.expires_at > NOW())
            ORDER BY a.is_pinned DESC, a.published_at DESC
            LIMIT 20
        `, [req.user.id, req.user.school_id]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching announcements:', error);
        res.status(500).json({ error: error.message });
    }
}

// Mark announcement as read
async function markAnnouncementRead(req, res) {
    const { id } = req.params;
    
    try {
        await pool.query(`
            INSERT INTO announcement_reads (announcement_id, user_id)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
        `, [id, req.user.id]);
        
        await pool.query(`
            UPDATE announcements SET view_count = view_count + 1 WHERE id = $1
        `, [id]);
        
        res.json({ message: 'Marked as read' });
    } catch (error) {
        console.error('Error marking announcement read:', error);
        res.status(500).json({ error: error.message });
    }
}

// Approve announcement (Admin only)
async function approveAnnouncement(req, res) {
    const { id } = req.params;
    const { status } = req.body;
    
    try {
        await pool.query(`
            UPDATE announcements 
            SET status = $1, approved_by = $2, approved_at = CURRENT_TIMESTAMP
            WHERE id = $3
        `, [status, req.user.id, id]);
        
        // If approved and has audience, send notifications
        if (status === 'published') {
            const announcement = await pool.query(`
                SELECT * FROM announcements WHERE id = $1
            `, [id]);
            
            // Send push notifications to target audience
            // Implementation depends on your notification system
        }
        
        res.json({ message: `Announcement ${status}` });
    } catch (error) {
        console.error('Error approving announcement:', error);
        res.status(500).json({ error: error.message });
    }
}

// ==================== MESSAGE TEMPLATES ====================

// Get message templates
async function getMessageTemplates(req, res) {
    try {
        const result = await pool.query(`
            SELECT * FROM message_templates
            WHERE school_id = $1 AND is_active = true
            ORDER BY template_type, template_name
        `, [req.user.school_id]);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching templates:', error);
        res.status(500).json({ error: error.message });
    }
}

// Send bulk message using template
async function sendBulkMessage(req, res) {
    const { template_id, recipients, variables } = req.body;
    
    try {
        const template = await pool.query(`
            SELECT * FROM message_templates WHERE id = $1
        `, [template_id]);
        
        if (template.rows.length === 0) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        const templateContent = template.rows[0].content;
        let successCount = 0;
        
        for (const recipient of recipients) {
            let message = templateContent;
            
            // Replace variables
            for (const [key, value] of Object.entries(variables[recipient.id] || {})) {
                message = message.replace(`{{${key}}}`, value);
            }
            
            // Send based on recipient type
            if (recipient.phone) {
                await sendSMS(recipient.phone, message);
                successCount++;
            }
            if (recipient.email) {
                await sendEmail(recipient.email, template.rows[0].subject, message);
                successCount++;
            }
        }
        
        res.json({ 
            message: `Bulk message sent to ${successCount} recipients`,
            success_count: successCount 
        });
    } catch (error) {
        console.error('Error sending bulk message:', error);
        res.status(500).json({ error: error.message });
    }
}

// ==================== MEETING BOOKINGS ====================

// Book parent-teacher meeting
async function bookMeeting(req, res) {
    const { teacher_id, student_id, meeting_date, start_time, end_time, purpose, meeting_type } = req.body;
    
    try {
        // Check availability
        const conflict = await pool.query(`
            SELECT id FROM meeting_bookings
            WHERE teacher_id = $1 AND meeting_date = $2
                AND ((start_time <= $3 AND end_time >= $3) OR (start_time <= $4 AND end_time >= $4))
        `, [teacher_id, meeting_date, start_time, end_time]);
        
        if (conflict.rows.length > 0) {
            return res.status(409).json({ error: 'Teacher already has a meeting at this time' });
        }
        
        const result = await pool.query(`
            INSERT INTO meeting_bookings (
                school_id, teacher_id, parent_id, student_id, meeting_date,
                start_time, end_time, purpose, meeting_type, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
            RETURNING id
        `, [req.user.school_id, teacher_id, req.user.id, student_id, meeting_date,
            start_time, end_time, purpose, meeting_type]);
        
        res.status(201).json({ id: result.rows[0].id, message: 'Meeting request sent' });
    } catch (error) {
        console.error('Error booking meeting:', error);
        res.status(500).json({ error: error.message });
    }
}

// Get my meetings
async function getMyMeetings(req, res) {
    try {
        const result = await pool.query(`
            SELECT mb.*, 
                   t.first_name as teacher_first, t.last_name as teacher_last,
                   p.first_name as parent_first, p.last_name as parent_last,
                   s.admission_number, u.first_name as student_first, u.last_name as student_last
            FROM meeting_bookings mb
            JOIN users t ON mb.teacher_id = t.id
            JOIN users p ON mb.parent_id = p.id
            JOIN students s ON mb.student_id = s.id
            JOIN users u ON s.user_id = u.id
            WHERE mb.parent_id = $1 OR mb.teacher_id = $1
            ORDER BY mb.meeting_date DESC, mb.start_time
        `, [req.user.id]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching meetings:', error);
        res.status(500).json({ error: error.message });
    }
}

module.exports = {
    getOrCreateConversation,
    getUserConversations,
    getConversationMessages,
    sendMessage,
    addReaction,
    createGroup,
    getUserGroups,
    createAnnouncement,
    getAnnouncements,
    markAnnouncementRead,
    approveAnnouncement,
    getMessageTemplates,
    sendBulkMessage,
    bookMeeting,
    getMyMeetings
};