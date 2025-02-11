const User = require("../../models/userSchema");
const Offer = require("../../models/offerSchema");
const Wishlist = require("../../models/wishlistSchema");
const nodemailer = require("nodemailer");
const env = require("dotenv").config();
const bcrypt = require("bcrypt");
const Product = require("../../models/productSchema");
const Category = require("../../models/categorySchema");
const Wallet = require('../../models/walletSchema');
const mongoose = require('mongoose')

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
      let isNewUser = false;

      if (user) {
        userData = await User.findOne({ _id: user }).lean();
        // Check if this is a new user (no referral code and recently registered)
        isNewUser = !userData.referredBy && !userData.referralCode && 
                   (new Date() - new Date(userData.createdAt)) < 24 * 60 * 60 * 1000; // 24 hours
        
        console.log('User details:', {
            userId: userData._id,
            hasReferralCode: !!userData.referralCode,
            hasReferredBy: !!userData.referredBy,
            createdAt: userData.createdAt,
            isNewUser: isNewUser
        });
    
        // If user has seen the modal, update their record
        if (isNewUser && req.session.hasSeenReferralModal) {
            isNewUser = false;
        }
        req.session.hasSeenReferralModal = true;
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
          user: { ...userData, isNewUser },
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


const applyReferral = async (req, res) => {
  try {
      const { referralCode } = req.body;
      const userId = req.session.user;

      console.log('Starting referral process:', { referralCode, userId });

      // Basic validation
      if (!referralCode || !userId) {
          return res.json({ 
              success: false, 
              message: 'Invalid request. Please login and try again.'
          });
      }

      // Find the referrer user
      const referrer = await User.findOne({ referralCode });
      console.log('Referrer found:', referrer ? referrer._id : 'Not found');
      
      if (!referrer) {
          return res.json({ 
              success: false, 
              message: 'Invalid referral code. Please check and try again.'
          });
      }

      // Check if user has already applied a referral code
      const newUser = await User.findById(userId);
      console.log('New user found:', newUser ? newUser._id : 'Not found');

      if (!newUser) {
          return res.json({ 
              success: false, 
              message: 'User not found. Please login and try again.'
          });
      }

      if (newUser.referredBy) {
          return res.json({ 
              success: false, 
              message: 'You have already used a referral code.'
          });
      }

      // Prevent self-referral
      if (newUser._id.toString() === referrer._id.toString()) {
          return res.json({ 
              success: false, 
              message: 'You cannot use your own referral code.'
          });
      }

      try {
          // Update user and handle wallet operations
          await User.findByIdAndUpdate(userId, {
              $set: { referredBy: referrer._id }
          });

          // Get or create wallet for new user
          let newUserWallet = await Wallet.findOne({ user: userId });
          if (!newUserWallet) {
              newUserWallet = new Wallet({ 
                  user: userId,
                  balance: 0,
                  transactions: []
              });
              await newUserWallet.save();
          }

          // Get or create wallet for referrer
          let referrerWallet = await Wallet.findOne({ user: referrer._id });
          if (!referrerWallet) {
              referrerWallet = new Wallet({ 
                  user: referrer._id,
                  balance: 0,
                  transactions: []
              });
              await referrerWallet.save();
          }

          // Add bonuses to wallets
          await newUserWallet.credit(1000, 'Referral bonus for using referral code', {
              reason: 'referral_bonus',
              metadata: {
                  referralCode: referralCode,
                  referrerId: referrer._id
              }
          });

          await referrerWallet.credit(500, 'Referral bonus for referral code usage', {
              reason: 'referral_reward',
              metadata: {
                  referredUserId: userId,
                  referralCode: referralCode
              }
          });

          return res.json({ 
              success: true, 
              message: 'Referral code applied successfully! ₹1000 has been added to your wallet.'
          });

      } catch (error) {
          console.error('Wallet operation error:', error);
          
          // Rollback the referral if wallet operations fail
          await User.findByIdAndUpdate(userId, {
              $unset: { referredBy: "" }
          });

          return res.json({ 
              success: false, 
              message: 'Failed to process wallet transaction. Please try again.',
              error: error.message
          });
      }

  } catch (error) {
      console.error('Referral error details:', {
          message: error.message,
          stack: error.stack,
          name: error.name
      });
      
      return res.json({ 
          success: false, 
          message: 'Something went wrong. Please try again later.',
          error: error.message
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

const generateReferralCode = (firstName) => {
  const timestamp = Date.now().toString().slice(-4);
  const prefix = firstName.slice(0, 3).toUpperCase();
  const randomStr = Math.random().toString(36).substring(2, 5).toUpperCase();
  return `${prefix}${randomStr}${timestamp}`;
};

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

const search = async (req, res) => {
  try {
      // Check if user is authenticated
      if (!req.session.user) {
          return res.status(401).json({
              success: false,
              message: 'Please login to continue'
          });
      }

      // Destructure query parameters with defaults
      const { 
          query, 
          category, 
          sort = 'newest', 
          page = 1, 
          maxPrice, 
          sizes, 
          colors 
      } = req.query;

      // Pagination settings
      const limit = 12;
      const skip = (parseInt(page) - 1) * limit;

      // Find the category document
      const categoryDoc = await Category.findOne({ 
          name: { $regex: new RegExp(category, 'i') },
          isListed: true
      });

      if (!categoryDoc) {
          return res.status(400).json({ 
              success: false, 
              message: 'Invalid category' 
          });
      }

      const currentDate = new Date();

      // Get active category offer
      const categoryOffer = await Offer.findOne({
          offerType: 'category',
          category: categoryDoc._id,
          isActive: true,
          startDate: { $lte: currentDate },
          endDate: { $gte: currentDate }
      });

      // Get user's wishlist
      let userWishlist = [];
      if (req.session.user) {
          const wishlistDoc = await Wishlist.findOne({ user: req.session.user._id });
          if (wishlistDoc) {
              userWishlist = wishlistDoc.items.map(item => item.product.toString());
          }
      }

      // Initialize aggregation pipeline
      const pipeline = [];

      // Base match stage
      pipeline.push({
          $match: {
              isListed: true,
              category: categoryDoc._id
          }
      });

      // Search query handling
      if (query && query.trim()) {
          pipeline.push({
              $match: {
                  $or: [
                      { productName: { $regex: query, $options: 'i' } },
                      { searchKeywords: { $regex: query, $options: 'i' } },
                      { tags: { $regex: query, $options: 'i' } }
                  ]
              }
          });
      }

      // Product offer lookup
      pipeline.push({
          $lookup: {
              from: 'offers',
              let: { productId: '$_id' },
              pipeline: [
                  {
                      $match: {
                          $expr: {
                              $and: [
                                  { $eq: ['$offerType', 'product'] },
                                  { $eq: ['$product', '$$productId'] },
                                  { $eq: ['$isActive', true] },
                                  { $lte: ['$startDate', currentDate] },
                                  { $gte: ['$endDate', currentDate] }
                              ]
                          }
                      }
                  }
              ],
              as: 'productOffer'
          }
      });

      // Unwind variants for filtering
      pipeline.push({ $unwind: '$variants' });
      pipeline.push({ $unwind: '$variants.colorVariant' });

      // Price filter
      if (maxPrice && !isNaN(parseFloat(maxPrice))) {
          pipeline.push({
              $match: {
                  'variants.colorVariant.price': { 
                      $lte: parseFloat(maxPrice) 
                  }
              }
          });
      }

      // Size filter
      if (sizes && sizes.length > 0) {
          const validSizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
          const sizeArray = sizes.split(',')
              .map(size => size.trim().toUpperCase())
              .filter(size => validSizes.includes(size));
          
          if (sizeArray.length > 0) {
              pipeline.push({
                  $match: {
                      'variants.colorVariant.size': { 
                          $in: sizeArray 
                      }
                  }
              });
          }
      }

      // Color filter
      if (colors && colors.length > 0) {
          const colorArray = colors.split(',')
              .map(color => color.trim())
              .filter(Boolean);

          if (colorArray.length > 0) {
              pipeline.push({
                  $match: {
                      'variants.colorName': {
                          $in: colorArray.map(color => 
                              new RegExp(color, 'i')
                          )
                      }
                  }
              });
          }
      }

      // Add price calculation fields
      pipeline.push({
          $addFields: {
              basePrice: '$variants.colorVariant.price',
              productOfferDiscount: {
                  $cond: {
                      if: { $gt: [{ $size: '$productOffer' }, 0] },
                      then: {
                          $multiply: [
                              '$variants.colorVariant.price',
                              { $divide: [{ $arrayElemAt: ['$productOffer.discountPercentage', 0] }, 100] }
                          ]
                      },
                      else: 0
                  }
              },
              categoryOfferDiscount: {
                  $cond: {
                      if: { $and: [
                          { $ne: [categoryOffer, null] },
                          { $ne: [categoryOffer?.discountPercentage, null] }
                      ]},
                      then: {
                          $multiply: [
                              '$variants.colorVariant.price',
                              { $divide: [(categoryOffer?.discountPercentage || 0), 100] }
                          ]
                      },
                      else: 0
                  }
              }
          }
      });

      // Calculate final price and offer details
      pipeline.push({
        $addFields: {
            basePrice: '$variants.colorVariant.price',
            finalPrice: {
                $subtract: [
                    '$variants.colorVariant.price',
                    {
                        $max: [
                            {
                                $cond: {
                                    if: { $gt: [{ $size: '$productOffer' }, 0] },
                                    then: {
                                        $multiply: [
                                            '$variants.colorVariant.price',
                                            { $divide: [{ $arrayElemAt: ['$productOffer.discountPercentage', 0] }, 100] }
                                        ]
                                    },
                                    else: 0
                                }
                            },
                            {
                                $cond: {
                                    if: { $and: [
                                        { $ne: ['$categoryOffer', null] },
                                        { $ne: ['$categoryOffer.discountPercentage', null] }
                                    ]},
                                    then: {
                                        $multiply: [
                                            '$variants.colorVariant.price',
                                            { $divide: ['$categoryOffer.discountPercentage', 100] }
                                        ]
                                    },
                                    else: 0
                                }
                            }
                        ]
                    }
                ]
            }
        }
    });

      // Sort configuration
      let sortStage = { createdAt: -1 }; // Default sort
      switch(sort) {
          case 'featured':
              sortStage = { 'productOffer': -1, createdAt: -1 };
              break;
          case 'popularity':
              sortStage = { viewCount: -1, createdAt: -1 };
              break;
          case 'price_asc':
              sortStage = { finalPrice: 1 };
              break;
          case 'price_desc':
              sortStage = { finalPrice: -1 };
              break;
          case 'name_asc':
              sortStage = { productName: 1 };
              break;
          case 'name_desc':
              sortStage = { productName: -1 };
              break;
      }
      pipeline.push({ $sort: sortStage });

      // Group products to maintain structure
      pipeline.push({
          $group: {
              _id: '$_id',
              productName: { $first: '$productName' },
              variants: { $first: '$variants' },
              finalPrice: { $first: '$finalPrice' },
              basePrice: { $first: '$basePrice' },
              hasOffer: { $first: '$hasOffer' },
              discountPercentage: { $first: '$discountPercentage' },
              appliedOfferType: { $first: '$appliedOfferType' },
              createdAt: { $first: '$createdAt' },
              viewCount: { $first: '$viewCount' }
          }
      });

      // Add pagination stages
      const paginatedPipeline = [
          ...pipeline,
          { $skip: skip },
          { $limit: limit }
      ];

      // Execute the aggregation
      const products = await Product.aggregate(paginatedPipeline);

      // Get total count for pagination
      const totalPipeline = [
          ...pipeline,
          { $count: 'total' }
      ];
      const totalResult = await Product.aggregate(totalPipeline);
      const total = totalResult[0]?.total || 0;

      // Format products for response
     // In your search controller, update the formattedProducts mapping:
     const formattedProducts = products.map(product => ({
      _id: product._id,
      productName: product.productName,
      image: product.variants?.productImage?.[0] || product.variants?.[0]?.productImage?.[0],
      originalPrice: product.basePrice,
      finalPrice: product.finalPrice,
      hasOffer: product.hasOffer,
      productOffer: product.discountPercentage || 0,
      discountPercentage: Math.round(product.discountPercentage || 0),
      appliedOfferType: product.appliedOfferType,
      isInWishlist: userWishlist.includes(product._id.toString())
  }));
      // Send response
      res.json({
          success: true,
          products: formattedProducts,
          pagination: {
              currentPage: parseInt(page),
              totalPages: Math.ceil(total / limit),
              totalProducts: total,
              hasNextPage: skip + limit < total,
              hasPreviousPage: page > 1,
              nextPage: parseInt(page) + 1,
              previousPage: parseInt(page) - 1
          },
          categoryOffer: categoryOffer ? {
              name: categoryOffer.name,
              discountPercentage: categoryOffer.discountPercentage
          } : null
      });

  } catch (error) {
      console.error('Search error:', error);
      res.status(500).json({ 
          success: false, 
          message: 'Internal server error',
          error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
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

    if (!user.referralCode) {
      user.referralCode = generateReferralCode(user.name);
      await user.save();
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
  applyReferral,
  search
};
