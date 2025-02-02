const User = require("../../models/userSchema");
const Offer = require("../../models/offerSchema");
const wishlist = require("../../models/wishlistSchema");
const nodemailer = require("nodemailer");
const env = require("dotenv").config();
const bcrypt = require("bcrypt");
const Product = require("../../models/productSchema");
const Category = require("../../models/categorySchema");

const pageNotFound = async (req, res) => {
  try {
    res.render("page_404");
  } catch (error) {
    res.redirect("/pageNotFound");
  }
};

const loadHomepage = async (req, res) => {
  try {
      const currentDate = new Date();
      // Get user from session
      const user = req.session.user;
      let userData = null;
      if (user) {
          userData = await User.findOne({ _id: user }).lean();
      }

      // Fetch all active offers
      const activeOffers = await Offer.find({
          isActive: true,
          startDate: { $lte: currentDate },
          endDate: { $gte: currentDate }
      }).lean();

      // Organize offers by type and ID
      const offerMap = {
          category: {},
          product: {}
      };
      activeOffers.forEach(offer => {
          if (offer.offerType === 'category') {
              offerMap.category[offer.category.toString()] = offer;
          } else {
              offerMap.product[offer.product.toString()] = offer;
          }
      });

      // Fetch categories for banners
      const categories = await Category.find({ isListed: true })
          .lean()
          .then(cats => cats.map(cat => ({
              ...cat,
              offer: offerMap.category[cat._id.toString()]?.discountPercentage || 0
          })));

      // Fetch featured products with category info
      const products = await Product.find({ isListed: true })
          .populate("category")
          .lean();

      // Process products to include offer prices
      const processedProducts = products.map(product => {
          const productId = product._id.toString();
          const categoryId = product.category?._id.toString();
          
          // Get applicable offers
          const productOffer = offerMap.product[productId];
          const categoryOffer = offerMap.category[categoryId];

          // Determine best offer
          let bestOffer = null;
          let offerType = null;
          if (productOffer && categoryOffer) {
              bestOffer = productOffer.discountPercentage > categoryOffer.discountPercentage ? 
                  productOffer : categoryOffer;
              offerType = productOffer.discountPercentage > categoryOffer.discountPercentage ? 
                  'product' : 'category';
          } else {
              bestOffer = productOffer || categoryOffer;
              offerType = productOffer ? 'product' : 'category';
          }

          // Calculate price range with offers
          let minPrice = Infinity;
          let maxPrice = 0;

          product.variants.forEach(variant => {
              variant.colorVariant.forEach(cv => {
                  if (cv.status === 'available' && cv.stock > 0) {
                      let finalPrice = cv.price;
                      if (bestOffer) {
                          finalPrice *= (1 - bestOffer.discountPercentage/100);
                      }
                      minPrice = Math.min(minPrice, finalPrice);
                      maxPrice = Math.max(maxPrice, finalPrice);
                  }
              });
          });

          return {
              ...product,
              minPrice: minPrice === Infinity ? 0 : Math.round(minPrice * 100) / 100,
              maxPrice: maxPrice === 0 ? 0 : Math.round(maxPrice * 100) / 100,
              originalMinPrice: product.variants[0]?.colorVariant[0]?.price || 0,
              originalMaxPrice: product.variants[0]?.colorVariant[0]?.price || 0,
              hasOffer: !!bestOffer,
              offerType,
              offerPercentage: bestOffer?.discountPercentage || 0,
              offerName: bestOffer?.name || null
          };
      });

      // Sort products by offer percentage for featured section
      const featuredProducts = processedProducts
          .sort((a, b) => b.offerPercentage - a.offerPercentage)
          .slice(0, 8); // Get top 8 products with best offers

      res.render("home", {
          user: userData,
          categories,
          featuredProducts,
          offers: [
              { 
                  title: 'Summer Collection 2025',
                  desc: 'Discover the latest trends',
                  image: '/images/product/banner1.jpg'
              },
              { 
                  title: 'New Arrivals',
                  desc: 'Shop the latest styles',
                  image: '/images/product/banner men 2.jpg'
              },
              { 
                  title: 'Special Offers',
                  desc: 'Up to 50% off',
                  image: '/images/product/banner 3.jpg'
              }
          ]
      });

  } catch (error) {
      console.error("Home page error:", error);
      res.status(500).render('error', {
          message: 'Something went wrong while loading the home page',
          error: process.env.NODE_ENV === 'development' ? error : {}
      });
  }
};

const loadSignUp = async (req, res) => {
  try {
    return res.render("signup");
  } catch (error) {
    console.log("signup page is not found");
    res.status(500).send("server error");
  }
};

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendVerificationEmail(email, otp) {


  const transporter = nodemailer.createTransport({
    service: 'gmail',
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: process.env.NODEMAILER_EMAIL,
      pass: process.env.NODEMAILER_PASSWORD
    },
    tls: {
      rejectUnauthorized: false
    }
  });

  const mailOptions = {
    from: `"ANAMIT" <${process.env.NODEMAILER_EMAIL}>`,
    to: email,
    subject: "Your Verification Code",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Email Verification</h2>
        <p>Your OTP is: <strong style="font-size: 24px; color: #007bff;">${otp}</strong></p>
        <p style="color: #666;">This code is valid for 1 minute.</p>
        <p style="color: #999; font-size: 12px;">If you didn't request this code, please ignore this email.</p>
      </div>
    `
  };

  try {
    // Verify connection configuration
    await transporter.verify();
    
    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent successfully:", info.messageId);
    return true;
  } catch (error) {
    console.error("SMTP Error:", {
      code: error.code,
      command: error.command,
      response: error.response,
      message: error.message
    });
    return false;
  } finally {
    // Clean up
    transporter.close();
  }
}

const signUp = async (req, res) => {
  try {
    const { name, phone, email, password, confirmPassword } = req.body;

    if (password !== confirmPassword) {
      return res.render("signUp", { message: "Password does not match" });
    }

    const findUser = await User.findOne({ email });
    if (findUser) {
      return res.render("signUp", { message: "User email already existed" });
    }

    const otp = generateOtp();
    const emailSend = await sendVerificationEmail(email, otp);

    if (!emailSend) {
      return res.json("email-error");
    }

    req.session.userOtp = { otp, createdAt: new Date() };
    req.session.userData = { name, phone, email, password };

    res.redirect("/verify-otp");
    console.log("OTP Sent", otp);
  } catch (error) {
    console.error("signup error", error);
    res.redirect("/pageNotFound");
  }
};


const verifyOtp = async (req, res) => {
  try {
    const { otp } = req.body;
    const sessionOtp = req.session.userOtp;
    const userData = req.session.userData;

    if (!otp || !sessionOtp || !userData) {
      return res.render("verify-otp", {
        message: "Session expired or invalid request. Please try again.",
      });
    }

    const { otp: storedOtp, createdAt } = sessionOtp;

    // Check if OTP has expired (1 minute = 60,000 ms)
    const now = new Date();
    const elapsedTime = now - new Date(createdAt);
    const otpValidityDuration = 60 * 1000; // 1 minute

    if (elapsedTime > otpValidityDuration) {
      console.log("otp expired");
      
      return res.status(400).send({ success: false, message: "OTP  expired" });
    }

    if (otp == storedOtp) {
      const hashedPassword = await bcrypt.hash(userData.password, 10);

      const newUser = new User({
        name: userData.name,
        phone: userData.phone,
        email: userData.email,
        password: hashedPassword,
        createdAt: Date.now(),
      });

      await newUser.save();

      req.session.userOtp = null;
      req.session.userData = null;

      res.status(200).send({
        success: true,
        message: "Redirecting to login page",
        redirectUrl: "/login",
      });
    } else {
      res.status(400).send({ success: false, message: "Invalid OTP" });
    }
  } catch (error) {
    console.error("OTP verification error:", error);
    res.redirect("/pageNotFound");
  }
};


const loadVerifyOtp = (req, res) => {
  res.render("verify-otp");
};

const resendOtp = async (req, res) => {
  console.log("Resend OTP called");

  try {
    if (!req.session.userData) {
      console.log("Session expired");
      return res.status(400).json({
        success: false,
        message: "Session expired. Please sign up again.",
      });
    }

    // Generate a new OTP and send the email
    const newOtp = generateOtp();
    const emailSend = await sendVerificationEmail(
      req.session.userData.email,
      newOtp
    );

    if (!emailSend) {
      console.log("Failed to send email");
      return res.status(500).json({
        success: false,
        message: "Failed to resend OTP.",
      });
    }

    // Update session with the new OTP and updated timestamp
    req.session.userOtp = { otp: newOtp, createdAt: new Date() };
    console.log("New OTP sent:", newOtp);

    res.status(200).json({
      success: true,
      message: "OTP has been resent successfully.",
    });
  } catch (error) {
    console.error("Resend OTP Error:", error);
    res.status(500).json({ success: false, message: "Something went wrong." });
  }
};

const handleGoogleCallback = async (req, res) => {
  try {
    if (!req.user) {
      return res.redirect('/login');
    }

    // Store user in session
    req.session.user = req.user._id;
    
    // Redirect to home page
    res.redirect('/');
  } catch (error) {
    console.error('Google callback error:', error);
    res.redirect('/login');
  }
};

const handleGoogleFailure = (req, res) => {
  res.redirect('/login');
};

const loadLoginPage = async (req, res) => {
  try {
    if (!req.session.user) {
      return res.render("login");
    } else {
      res.redirect("/");
    }
  } catch (error) {
    res.redirect("/pageNotFound");
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    
    console.log(email, password);

    // Find the user by email, whether Google or local login
    const findUser = await User.findOne({ email });
 console.log(findUser , "vjysagfv")
    if (!findUser) {
      return res.render("login", { message: "User not found" });
    }

    if (findUser.isBlocked) {
      return res.render("login", { message: "User is blocked by admin" });
    }

    // If authProvider is local, verify password
    if (findUser.authProvider === "local") {
      const passwordMatch = await bcrypt.compare(password, findUser.password);

      if (!passwordMatch) {
        return res.render("login", { message: "Incorrect password" });
      }
    }

    // Save user data in session for both Google and local users
    req.session.user = findUser._id;
    console.log(req.session.user);

    // Redirect to home page
    return res.redirect("/");
  } catch (error) {
    console.error("Login error:", error);
    return res.render("login", { message: "Please try again" });
  }
};

const logout = async (req, res) => {
  try {
    req.session.destroy((err) => {
      if (err) {
        console.log("Session destruction error", err.message);
        return res.redirect("/pageNoteFound");
      }
      return res.redirect("/login");
    });
  } catch (error) {
    console.log("logout error", error);
    res.redirect("/pageNotFound");
  }
};





const loadUserProfile = async (req,res) => {
  
    try {
     
      const userId = req?.session?.user || req.session?.passport?.user;
      console.log("users",req?.session?.user);
      console.log("user google",req.session?.passport?.user);
      
      const user = await User.findById(userId);

      console.log("finded",user);
      

      if (!user) {
        return res.status(404).render('error', { 
            message: 'User not found'
        });
    }

    res.render('userProfile', { 
      user: user,  // This sends the user data to your template
      title: 'My Profile'
  });

    } catch (error) {
      console.error('Profile fetch error:', error);
        res.status(500).render('error', { 
            message: 'Error fetching profile'
        });
    }  
} 
 
const getEditProfile = async (req, res) => {
 
    try {
      const user = await User.findById(req.user._id).select('-password');
      res.render('userProfileEdit', { 
          user,
          messages: req.flash()
      });
  } catch (error) {
      console.error('Error fetching user profile:', error);
      req.flash('error', 'Error loading profile');
      res.redirect('/');
  }
  }

  const updateProfile = async (req, res) => {
    try {
        const { name, phone } = req.body;
        const userId = req.session.user; // Changed from req.session.userId to req.session.user

        // Check if user is logged in
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Please login to update profile'
            });
        }

        const errors = [];

        // Name validation
        const nameRegex = /^[A-Za-z\s]{3,50}$/;
        if (!name || !nameRegex.test(name)) {
            errors.push('Invalid name format');
        }

        // Phone validation
        const phoneRegex = /^[0-9]{10}$/;
        if (!phone || !phoneRegex.test(phone)) {
            errors.push('Invalid phone number format');
        }

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                message: errors.join(', ')
            });
        }

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { 
                name, 
                phone,
                updatedAt: new Date()
            },
            { new: true, runValidators: true }
        );

        if (!updatedUser) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Update session with new user data
        req.session.user = updatedUser._id;
        
        return res.status(200).json({
            success: true,
            message: 'Profile updated successfully',
            user: {
                name: updatedUser.name,
                phone: updatedUser.phone,
                email: updatedUser.email
            }
        });

    } catch (error) {
        console.error('Error updating profile:', error);
        return res.status(500).json({
            success: false,
            message: 'Error updating profile'
        });
    }
};

const loadForgotPassword = async (req, res) => {
  try {
      res.render('forgotPassword', {
          messages: {
              success: req.flash('success'),
              error: req.flash('error')
          }
      });
  } catch (error) {
      console.error('Error loading forgot password page:', error);
      res.status(500).render('error', { message: 'Internal server error' });
  }
};

const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found with this email' 
      });
    }

    const otp = generateOtp();
    console.log("Forgot Password OTP generated:", otp); // Added logging

    req.session.resetPasswordOtp = {
      email,
      otp,
      createdAt: new Date()
    };

    const emailSent = await sendVerificationEmail(email, otp);
    console.log("Forgot Password OTP sent:", otp); // Added logging

    if (!emailSent) {
      return res.status(500).json({
        success: false,
        message: 'Failed to send OTP email'
      });
    }

    res.status(200).json({
      success: true,
      message: 'OTP has been sent to your email'
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

const verifyForgotPasswordOtp = async (req, res) => {
  try {
    const { otp } = req.body;
    const sessionOtp = req.session.resetPasswordOtp;

    if (!otp || !sessionOtp) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP request'
      });
    }

    // Check if OTP has expired (1 minute validity as per your existing logic)
    const now = new Date();
    const elapsedTime = now - new Date(sessionOtp.createdAt);
    const otpValidityDuration = 60 * 1000; // 1 minute

    if (elapsedTime > otpValidityDuration) {
      return res.status(400).json({
        success: false,
        message: 'OTP has expired'
      });
    }

    if (otp !== sessionOtp.otp) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP'
      });
    }

    // OTP is valid - allow password reset
    res.status(200).json({
      success: true,
      message: 'OTP verified successfully'
    });

  } catch (error) {
    console.error('OTP verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { newPassword, confirmPassword } = req.body;
    const sessionOtp = req.session.resetPasswordOtp;

    if (!sessionOtp || !sessionOtp.email) {
      return res.status(400).json({
        success: false,
        message: 'Invalid password reset request'
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match'
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update user's password
    await User.findOneAndUpdate(
      { email: sessionOtp.email },
      { password: hashedPassword }
    );

    // Clear session OTP data
    req.session.resetPasswordOtp = null;

    res.status(200).json({
      success: true,
      message: 'Password reset successful'
    });

  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

const resendForgotPasswordOtp = async (req, res) => {
  try {
    const sessionData = req.session.resetPasswordOtp;
    console.log('Session data:', sessionData);
    
    if (!sessionData || !sessionData.email) {
      return res.status(400).json({
        success: false,
        message: 'Invalid resend request'
      });
    }

    const newOtp = generateOtp();
    console.log('Forgot Password OTP resent:', newOtp); // Added logging

    const emailSent = await sendVerificationEmail(sessionData.email, newOtp);

    if (!emailSent) {
      return res.status(500).json({
        success: false, 
        message: 'Failed to resend OTP'
      });
    }

    req.session.resetPasswordOtp = {
      email: sessionData.email,
      otp: newOtp,
      createdAt: new Date()
    };

    res.status(200).json({
      success: true,
      message: 'New OTP has been sent to your email'
    });

  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error' 
    });
  }
};


const searchProducts = async (req, res) => {
  try {
      const query = req.query.q;
      
      // Basic validation
      if (!query || query.length < 2) {
          return res.json({ 
              success: true, 
              products: [], 
              categories: [] 
          });
      }

      console.log('Search query:', query); // Debug log

      // Basic product search
      const products = await Product.find({
          $or: [
              { productName: { $regex: query, $options: 'i' } },
              { brand: { $regex: query, $options: 'i' } },
              { 'variants.colorName': { $regex: query, $options: 'i' } }
          ],
          isListed: true
      })
      .populate('category')
      .limit(8)
      .lean();

      console.log('Found products:', products.length); // Debug log

      // Basic category search
      const categories = await Category.find({
          name: { $regex: query, $options: 'i' },
          isListed: true
      })
      .limit(4)
      .lean();

      console.log('Found categories:', categories.length); // Debug log

      // Process products for response
      const processedProducts = products.map(product => {
          // Get minimum price from variants
          let minPrice = Infinity;
          
          product.variants.forEach(variant => {
              variant.colorVariant.forEach(cv => {
                  if (cv.price < minPrice) {
                      minPrice = cv.price;
                  }
              });
          });

          // Calculate final price with offer
          const basePrice = minPrice === Infinity ? 0 : minPrice;
          const finalPrice = product.productOffer > 0 
              ? basePrice * (1 - product.productOffer / 100)
              : basePrice;

          return {
              _id: product._id,
              productName: product.productName,
              category: product.category,
              price: finalPrice,
              originalPrice: basePrice,
              productOffer: product.productOffer,
              imageUrl: product.variants[0]?.productImage[0] || '/placeholder.jpg'
          };
      });

      console.log('Processed products:', processedProducts.length); // Debug log

      res.json({
          success: true,
          products: processedProducts,
          categories
      });

  } catch (error) {
      console.error('Search error:', error);
      res.status(500).json({
          success: false,
          error: 'Internal server error',
          details: error.message
      });
  }
};




module.exports = {
  loadHomepage,
  pageNotFound,
  loadSignUp,
  signUp,
  verifyOtp,
  loadVerifyOtp,
  resendOtp,
  loadLoginPage,
  login,
  logout,
  loadUserProfile,
  loadUserProfile,
  handleGoogleCallback,
  handleGoogleFailure,
  getEditProfile,
  updateProfile,
  forgotPassword,
  loadForgotPassword,
  verifyForgotPasswordOtp,
  resetPassword,
  resendForgotPasswordOtp,
  searchProducts
};
