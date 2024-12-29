const express = require('express')
const router = express.Router();
const userController = require('../controllers/user/userController');

router.get('/pageNotFound',userController.pageNotFound)
router.get('/', userController.loadHomepage);
router.get('/signup',userController.loadSignUp)
router.post('/signup',userController.signUp)



// router.get('/pageNotFound', (req, res, next) => {
//     console.log('404 Page Not Found route hit');
//     next(); // Call the controller
//   }, userController.pageNotFound);
  
//   router.get('/', (req, res, next) => {
//     console.log('Homepage route hit');
//     next(); // Call the controller
//   }, userController.loadHomepage);
  
//   router.get('/signup', (req, res, next) => {
//     console.log('Signup route hit');
//     next(); // Call the controller
//   }, userController.loadSignUp);
  
//   router.post('/signup', (req, res, next) => {
//     console.log('Signup POST route hit');
//     console.log('Request Body:', req.body);
//     next(); // Call the controller
//   }, userController.signUp);
  
  module.exports = router; 