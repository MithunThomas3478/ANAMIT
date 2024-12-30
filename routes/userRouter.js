const express = require('express')
const router = express.Router();
const userController = require('../controllers/user/userController');

router.get('/pageNotFound',userController.pageNotFound)
router.get('/', userController.loadHomepage);
router.get('/signup',userController.loadSignUp)
router.post('/signup',userController.signUp)
router.post('/verify-otp',userController.verifyOtp)
router.get('/verify-otp',userController.loadVerifyOtp)

  
  module.exports = router; 