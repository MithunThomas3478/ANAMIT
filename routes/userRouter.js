const express = require("express");
const router = express.Router();
const userController = require("../controllers/user/userController");
const productController = require("../controllers/user/productController");
const addressController = require('../controllers/user/addressController');
const passwordController = require('../controllers/user/passwordController');
const cartController = require('../controllers/user/cartController');
const checkoutController = require('../controllers/user/checkOutController')
const { userAuth } = require("../middlewares/auth");
const passport = require("passport");


router.get("/pageNotFound", userController.pageNotFound);
router.get("/", userController.loadHomepage);
router.get("/signup", userController.loadSignUp);
router.post("/signup", userController.signUp);
router.post("/verify-otp", userController.verifyOtp);
router.get("/verify-otp", userController.loadVerifyOtp);
router.post("/resend-otp", userController.resendOtp);
router.get("/login", userController.loadLoginPage);
router.post("/login", userController.login);
router.get("/logout", userController.logout);
router.get('/forgotPassword', userController.loadForgotPassword);
router.post('/forgot-password', userController.forgotPassword);
router.post('/verify-forgot-password-otp', userController.verifyForgotPasswordOtp);
router.post('/reset-password', userController.resetPassword);
router.post('/resend-forgot-password-otp', userController.resendForgotPasswordOtp);



// Google login
router.get(
  "/auth/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

router.get(
  "/auth/google/callback",
  passport.authenticate("google", {
    failureRedirect: "/login",
    failureHandler: userController.handleGoogleFailure
  }),
  userController.handleGoogleCallback
);

router.use(userAuth);
router.get('/mens',userController.getMensFashion);
router.get('/womens',userController.getWomensFashion);
router.get('/productDetails/:id',productController.getProductDetails);

router.post('/addToCart', productController.addToCart);

router.get('/cart', cartController.getCart);
router.post('/updateQuantity',cartController.updateQuantity);
router.post('/removeProduct',cartController.removeProduct);


router.get('/checkout',checkoutController.getCheckout);
router.post('/placeOrder',checkoutController.placeOrder);
router.get('/orderSuccess/:orderId',checkoutController.orderSuccess);


router.get('/userProfile',userController.loadUserProfile);
router.get('/editProfile',userController.getEditProfile);
router.post('/editProfile/update',userController.updateProfile);
router.get('/userAddress',addressController.getAllAdress);
router.post('/addAddress',addressController.addAddress);
router.get('/updateAddress/:id',addressController.getEditAddress);
router.post('/updateAddress',addressController.updateAddress);
router.delete('/deleteAddress/:id',addressController.deleteAddress);

router.get('/passwordMangement',passwordController.loadPasswordManager);
router.post('/changePassword',passwordController.changePassword);


module.exports = router;
