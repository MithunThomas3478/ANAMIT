const user = require('../../models/userSchema')
const nodemailer = require('nodemailer')
const env = require("dotenv").config()

const pageNotFound = async (req,res) => {
    try {
       res.render('page_404');
    } catch (error) {
       res.redirect('/pageNotFound');
    }
}

const loadHomepage = async (req,res) => {
    try {
        return res.render('home');
    } catch (error) {
        console.log('Home page not found',error);
        res.status(500).send('server error');
    }
}

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

        const findUser = await user.findOne({email})
        if(findUser){
            return res.render('signUp',{message : 'User email already existed'});
        }

        const otp = generateOtp();
        const emailSend = await sendVerificationEmail(email,otp);
        
        if(!emailSend){
            return res.json('email-error');
        }

        req.session.userOtp = otp;
        req.session.userData = {name,phone,email,password,name,phone}

        res.render('verify-otp');
        console.log('OTP Sent',otp);
    } catch (error) {
        console.error('signup error',error);
        res.redirect('/pageNotFound');
    }
}


module.exports = {
    loadHomepage,
    pageNotFound,
    loadSignUp,
    signUp
}