
const User = require('../../models/userSchema')
const nodemailer = require('nodemailer')
const env = require("dotenv").config()
const bcrypt = require('bcrypt');


const pageNotFound = async (req,res) => {
    try {
       res.render('page_404');
    } catch (error) {
       res.redirect('/pageNotFound');
    }
}

const loadHomepage = async (req, res) => {
    try {
      const user = req.session.user; // Retrieve user from session
      
      if (user) {
        // If session has the user object, no need to query the database
        // If you need to fetch user data from the database, you can use the ID
        const user = req.session.user;
        console.log(req.session.user)
        // const userData = user._id ? await user.findOne({ _id: user._id }) : user;
        const userData = await User.findOne({ _id: user }) ;
        
        // res.render('home', { user: userData ,user}); // Render home page with user data
        res.render('home', { user: userData }); // Render home page with user data
      } else {
        // If user is not logged in (session user does not exist)
        res.render('home'); // Render home page without user data
      }
    } catch (error) {
      console.log('Home page not found', error);
      res.status(500).send('Server error');
    }
  };
  

const loadSignUp = async (req,res) => {
    try {
        return res.render('signup');
    } catch (error) {
        console.log('signup page is not found');
        res.status(500).send('server error');
    }
}

function generateOtp() {
    return Math.floor(100000 + Math.random()*900000).toString();
}


async function sendVerificationEmail(email, otp) {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      port: 587,
      secure: false, // Use true for port 465
      auth: {
        user: process.env.NODEMAILER_EMAIL,
        pass: process.env.NODEMAILER_PASSWORD,
      },
      logger:true,
      debug:true
    });
  
    const mailOptions = {
      from: `"Anamit" <${process.env.NODEMAILER_EMAIL}>`, // Correct syntax
      to: email,
      subject: 'Your Verification Code',
      html: `
        <p>Your OTP is <strong>${otp}</strong>.</p>
        <p>This code is valid for 10 minutes.</p>
      `,
    };
  
    try {
      const info = await transporter.sendMail(mailOptions);
      console.log('Email sent:', info.response);
      return true; // Return true if email sent successfully
    } catch (error) {
      console.error('Error sending email:', error.message);
      return false; // Return false if email sending fails
    }
  }
  
  const signUp = async (req,res) => {
    
    try {
        const {name,phone,email,password,confirmPassword} = req.body;

        if(password !== confirmPassword){
            return res.render('signUp',{message : 'Password does not match'});
        }

        const findUser = await User.findOne({email})
        if(findUser){
            return res.render('signUp',{message : 'User email already existed'});
        }

        const otp = generateOtp();
        const emailSend = await sendVerificationEmail(email,otp);
        
        if(!emailSend){
            return res.json('email-error');
        }

        req.session.userOtp = otp;
        req.session.userData = {name,phone,email,password,}

        res.redirect('/verify-otp');
        console.log('OTP Sent',otp);
    } catch (error) {
        console.error('signup error',error);
        res.redirect('/pageNotFound');
    }
}

const verifyOtp = async (req,res) => {
   try {
    
    const {otp} = req.body;
    console.log('sfkadyu',otp)
    const sessionOtp = req.session.userOtp;
    const userData = req.session.userData;
    console.log('dsvd',sessionOtp)
    console.log('123456',userData)
    
    if(!otp || !sessionOtp || !userData){
        return res.render('verify-otp',{message: 'Session expired or invalid request. Please try again.'});
    }
    
    if(otp == sessionOtp){
        const hashedPassword = await bcrypt.hash(userData.password,10);

        const newUser = new User({
            name : userData.name,
            phone : userData.phone,
            email : userData.email,
            password : hashedPassword,
            createdAt : Date.now()
        });

        await newUser.save();

        req.session.userOtp = null;
        req.session.userData = null;

        res.status(200).send({success:true,message:"redirecting to login page",redirectUrl:"/login"})
    }else{
      res.status(400).send({success:false,message:"invalid otp"});
    }

   } catch (error) {
    console.error('OTP verfication error:',error);
    res.redirect('/pageNotFound');
   }
}

const loadVerifyOtp = (req,res)=>{
    res.render('verify-otp')
}

const resendOtp = async (req, res) => {
    console.log("Resend OTP called");

    try {
        if (!req.session.userData) {
            console.log("Session expired");
            return res.status(400).json({ success: false, message: "Session expired. Please sign up again." });
        }

        const newOtp = generateOtp();
        const emailSend = await sendVerificationEmail(req.session.userData.email, newOtp);

        if (!emailSend) {
            console.log("Failed to send email");
            return res.status(500).json({ success: false, message: "Failed to resend OTP." });
        }

        req.session.userOtp = newOtp;
        console.log("New OTP sent:", newOtp);
        res.status(200).json({ success: true, message: "OTP has been resent successfully." });
    } catch (error) {
        console.error("Resend OTP Error:", error);
        res.status(500).json({ success: false, message: "Something went wrong." });
    }
};

const loadLoginPage = async (req,res)=>{
    try {
        if(!req.session.user){
            return res.render('login');
        }else{
            res.redirect('/');
        }
       
    } catch (error) {
        res.redirect('/pageNotFound')
    }
}



const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        console.log(email, password);
        
        // Find the user by email, whether Google or local login
        const findUser = await User.findOne({ email });

        if (!findUser) {
            return res.render('login', { message: 'User not found' });
        }

        if (findUser.isBlocked) {
            return res.render('login', { message: 'User is blocked by admin' });
        }

        // If authProvider is local, verify password
        if (findUser.authProvider === 'local') {
            const passwordMatch = await bcrypt.compare(password, findUser.password);

            if (!passwordMatch) {
                return res.render('login', { message: 'Incorrect password' });
            }
        }

        // Save user data in session for both Google and local users
        req.session.user = findUser._id;
        console.log(req.session.user);

        // Redirect to home page
        return res.redirect('/');
    } catch (error) {
        console.error('Login error:', error);
        return res.render('login', { message: 'Please try again' });
    }
};


const logout = async (req,res) => {
    try {
        req.session.destroy((err)=>{
            if(err){
                console.log('Session destruction error',err.message);
                return res.redirect('/pageNoteFound');
            }
            return res.redirect('/login')
        })
    } catch (error) {
        console.log('logout error',error);
        res.redirect('/pageNotFound')
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
    logout
  

}