const express = require('express');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const {
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
} = require('../controllers/messagingController');

const router = express.Router();

// Conversations
router.get('/conversations', authenticateToken, getUserConversations);
router.post('/conversations/user/:user_id', authenticateToken, getOrCreateConversation);
router.get('/conversations/:conversation_id/messages', authenticateToken, getConversationMessages);
router.post('/messages', authenticateToken, sendMessage);
router.post('/messages/:message_id/reactions', authenticateToken, addReaction);

// Groups
router.get('/groups', authenticateToken, getUserGroups);
router.post('/groups', authenticateToken, createGroup);

// Announcements
router.get('/announcements', authenticateToken, getAnnouncements);
router.post('/announcements', authenticateToken, authorizeRole('teacher', 'school_admin'), createAnnouncement);
router.post('/announcements/:id/read', authenticateToken, markAnnouncementRead);
router.put('/announcements/:id/approve', authenticateToken, authorizeRole('school_admin'), approveAnnouncement);

// Templates
router.get('/templates', authenticateToken, getMessageTemplates);
router.post('/bulk-message', authenticateToken, authorizeRole('school_admin'), sendBulkMessage);

// Meetings
router.get('/meetings', authenticateToken, getMyMeetings);
router.post('/meetings/book', authenticateToken, authorizeRole('parent'), bookMeeting);

module.exports = router;