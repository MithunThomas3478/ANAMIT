const User = require("../../models/userSchema");
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
    const user = req.session.user;

    // Fetch all available products
    const products = await Product.find({ isBlocked: false })
      .populate("category")
      .lean(); // Using lean() for better performance
      console.log(products);
      

    // Group products by category type (TOPWEAR, BOTTOMWEAR)
    const topwear = products.filter((product) =>
      product.category?.name.toUpperCase().includes("MEN")
    );
    const bottomwear = products.filter((product) =>
      product.category?.name.toUpperCase().includes("WOMEN")
    );

    let userData = null;
    if (user) {
      userData = await User.findOne({ _id: user });
    }

    res.render("home", {
      user: userData,
      topwear,
      bottomwear,
      products,
    });
  } catch (error) {
    console.log("Home page error:", error);
    res.status(500).send("Server error");
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
    service: "gmail",
    port: 587,
    secure: false, // Use true for port 465
    auth: {
      user: process.env.NODEMAILER_EMAIL,
      pass: process.env.NODEMAILER_PASSWORD,
    },
    logger: true,
    debug: true,
  });

  const mailOptions = {
    from: `"Anamit" <${process.env.NODEMAILER_EMAIL}>`, // Correct syntax
    to: email,
    subject: "Your Verification Code",
    html: `
        <p>Your OTP is <strong>${otp}</strong>.</p>
        <p>This code is valid for 10 minutes.</p>
      `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent:", info.response);
    return true; // Return true if email sent successfully
  } catch (error) {
    console.error("Error sending email:", error.message);
    return false; // Return false if email sending fails
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


const getMensFashion = async (req, res) => {
  try {
      // Get the men's category
      const menCategory = await Category.findOne({
          isListed: true,
          name: 'MEN'
      });

      if (!menCategory) {
          return res.status(404).render('error', {
              message: 'Category not found'
          });
      }

      // Get men's products
      const query = {
          isListed: true,
          category: menCategory._id  // Filter by men's category ID
      };

      // Apply price filter if exists
      if (req.query.maxPrice) {
          query['variants.colorVariant.price'] = { 
              $lte: parseFloat(req.query.maxPrice) 
          };
      }

      // Apply size filter if exists
      if (req.query.sizes) {
          const sizes = Array.isArray(req.query.sizes) 
              ? req.query.sizes 
              : [req.query.sizes];
          query['variants.colorVariant.size'] = { $in: sizes };
      }

      // Apply color filter if exists
      if (req.query.colors) {
          const colors = Array.isArray(req.query.colors) 
              ? req.query.colors 
              : [req.query.colors];
          query['variants.colorName'] = { $in: colors };
      }

      // Apply sorting
      let sort = {};
      switch (req.query.sort) {
          case 'price_asc':
              sort = { 'variants.colorVariant.price': 1 };
              break;
          case 'price_desc':
              sort = { 'variants.colorVariant.price': -1 };
              break;
          case 'newest':
              sort = { createdAt: -1 };
              break;
          default:
              sort = { createdAt: -1 }; // Default sort
      }

      // Get filtered and sorted products
      const products = await Product.find(query)
          .sort(sort)
          .populate('category')  // Populate category information
          .lean();

      // Get unique colors from all products
      const colors = [...new Set(products.flatMap(product => 
          product.variants.map(variant => ({
              colorName: variant.colorName,
              colorValue: variant.colorValue
          }))
      ))];

      // Remove duplicate colors
      const uniqueColors = Array.from(new Map(colors.map(item => 
          [item.colorName, item])).values());

      res.render('categoryMenwear', {
          title: "MEN",
          category: menCategory,  // Pass single category instead of categories array
          products,
          colors: uniqueColors,
          currentFilters: req.query
      });

  } catch (error) {
      console.error('Error in getMensFashion:', error);
      res.status(500).render('error', {
          message: 'Internal server error'
      });
  }
};

const getWomensFashion = async (req, res) => {
  try {
      // First find the women's category
      const womenCategory = await Category.findOne({ 
          name: 'WOMEN',
          isListed: true 
      });

      if (!womenCategory) {
          return res.status(404).render('error', {
              message: 'Category not found'
          });
      }

      // Get all products for women
      const query = {
          isListed: true,
          category: womenCategory._id  // Filter products by women's category
      };

      // Apply price filter if exists
      if (req.query.maxPrice) {
          query['variants.colorVariant.price'] = { 
              $lte: parseFloat(req.query.maxPrice) 
          };
      }

      // Apply size filter if exists
      if (req.query.sizes) {
          const sizes = Array.isArray(req.query.sizes) 
              ? req.query.sizes 
              : [req.query.sizes];
          query['variants.colorVariant.size'] = { $in: sizes };
      }

      // Apply color filter if exists
      if (req.query.colors) {
          const colors = Array.isArray(req.query.colors) 
              ? req.query.colors 
              : [req.query.colors];
          query['variants.colorName'] = { $in: colors };
      }

      // Apply sorting
      let sort = {};
      switch (req.query.sort) {
          case 'price_asc':
              sort = { 'variants.colorVariant.price': 1 };
              break;
          case 'price_desc':
              sort = { 'variants.colorVariant.price': -1 };
              break;
          case 'newest':
              sort = { createdAt: -1 };
              break;
          default:
              sort = { createdAt: -1 }; // Default sort
      }

      const products = await Product.find(query)
          .sort(sort)
          .lean();

      // Get unique colors from all products
      const colors = [...new Set(products.flatMap(product => 
          product.variants.map(variant => ({
              colorName: variant.colorName,
              colorValue: variant.colorValue
          }))
      ))];

      // Remove duplicate colors
      const uniqueColors = Array.from(new Map(colors.map(item => 
          [item.colorName, item])).values());

      res.render('categoryWomenwear', {
          title: "WOMEN",
          products,
          colors: uniqueColors,
          currentFilters: req.query
      });

  } catch (error) {
      console.error('Error in getWomensFashion:', error);
      res.status(500).render('error', {
          message: 'Internal server error'
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
  getMensFashion,
  getWomensFashion,
  loadUserProfile
};
