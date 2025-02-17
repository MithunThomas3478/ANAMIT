const express = require("express");
const router = express.Router();
const userController = require("../controllers/user/userController");
const productController = require("../controllers/user/productController");
const addressController = require('../controllers/user/addressController');
const passwordController = require('../controllers/user/passwordController');
const cartController = require('../controllers/user/cartController');
const checkoutController = require('../controllers/user/checkOutController');
const orderController = require('../controllers/user/orderController');
const walletController = require('../controllers/user/walletController');

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

router.get('/search',userController.search)

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
router.post('/apply-referral',userController.applyReferral)
router.get('/mens',productController.getMensFashion);
router.get('/womens',productController.getWomensFashion);
router.get('/productDetails/:id',productController.getProductDetails);

router.post('/toggleWishlist', productController.toggleWishlist);
router.get('/wishlist', productController.getWishlist);
router.post('/removeWishlist', productController.removeFromWishlist);
router.post('/addToCart', productController.addToCart);

router.get('/cart', cartController.getCart);
router.post('/updateQuantity',cartController.updateQuantity);
router.post('/removeProduct',cartController.removeProduct);

 
router.get('/checkout', checkoutController.getCheckout);
router.post('/checkout/placeOrder', checkoutController.placeOrder);
router.post('/checkout/create-razorpay-order', checkoutController.createRazorpayOrder);
router.post('/checkout/verify-razorpay-payment', checkoutController.verifyRazorpayPayment);
router.get('/checkout/orderSuccess/:orderId?', checkoutController.orderSuccess);
router.post('/checkout/address', checkoutController.addCheckoutAddress);
router.get('/orders',orderController.getUserOrders);

router.get('/orders/:orderId', orderController.getOrderDetails);
router.post('/orders/:orderId/items/:itemId/cancel', orderController.cancelOrderItem);
router.post('/orders/:orderId/items/:itemId/return', orderController.returnOrderItem);

router.post('/orders/payment/create-order', orderController.createRazorpayOrder);
router.post('/orders/payment/verify/:orderId', orderController.verifyRazorpayPayment);
router.post('/orders/payment/verify/:orderId', orderController.retryPayment);

router.post('/checkout/apply-coupon', checkoutController.applyCoupon);
router.post('/checkout/remove-coupon', checkoutController.removeCoupon);
router.get('/checkout/available-coupons', checkoutController.getAvailableCoupons);


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

router.get('/wallet',walletController.getWalletPage);
router.post('/wallet/create-order',walletController.createOrder);
router.post('/wallet/verify-payment',walletController.verifyPayment);
router.get('/wallet/transactions',walletController.getTransactionHistory);
router.get('/wallet/balance',walletController.checkBalance);
router.post('/wallet/deduct',walletController.deductMoney);






module.exports = router;