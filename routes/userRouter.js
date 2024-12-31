const express = require('express')
const router = express.Router();
const userController = require('../controllers/user/userController');
const passport = require('passport');

router.get('/pageNotFound',userController.pageNotFound);
router.get('/', userController.loadHomepage); 
router.get('/signup',userController.loadSignUp);
router.post('/signup',userController.signUp);
router.post('/verify-otp',userController.verifyOtp);
router.get('/verify-otp',userController.loadVerifyOtp);
router.post('/resend-otp',userController.resendOtp);
router.get('/login',userController.loadLoginPage);
router.post('/login',userController.login)
router.get('/logout',userController.logout)

router.get('/auth/google',passport.authenticate('google',{scope:['profile','email']}));
router.get('/auth/google/callback',passport.authenticate('google',{failureRedirect:'/login'}),(req,res)=>{
  res.redirect('/')
}); 
  
  module.exports = router; 