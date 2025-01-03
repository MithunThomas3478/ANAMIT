const express = require('express');
const adminController = require('../controllers/admin/adminController');
const customerController = require('../controllers/customer/customersController')
const router = express.Router();
const{userAuh,adminAuth} = require('../middlewares/auth')

router.get('/login', adminController.loadLogin);
router.post('/login', adminController.adminLogin);
router.get('/dashboard', adminController.loadDashboard);
router.get('/pageerror',adminController.pageerror);
router.get('/logout',adminController.logout);

// Route for loading users page
router.get('/users', customerController.loadUsers);

// Route for toggling user block status
router.post('/users/toggle-block/:id', customerController.toggleBlock);



module.exports = router;
