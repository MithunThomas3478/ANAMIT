const express = require("express");
const router = express.Router();
const userController = require("../controllers/user/userController");
const productController = require("../controllers/user/productController");
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

// Google login
router.get(
  "/auth/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);
router.get(
  "/auth/google/callback",
  passport.authenticate("google", {
    failureRedirect: "/login",
  }),
  (req, res) => {
    req.session.passport.user = req.user; // Store the authenticated user in session
    res.redirect("/"); // Redirect to the homepage or desired route
  }
);

router.use(userAuth);
router.get('/mens',userController.getMensFashion);
router.get('/womens',userController.getWomensFashion);
router.get('/productDetails/:id',productController.getProductDetails);
router.get('/userProfile',userController.loadUserProfile)

module.exports = router;
