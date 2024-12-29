const user = require('../../models/userSchema')
const nodemailer = require('nodemailer')

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
        console.log('Home page not found');
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


async function sendVerificationEmail(email,otp) {

    const transpoter = nodemailer.createTransport({
        service : ' gmail',
        port : 587,
        secure : false,
        requireTLS : true,
        auth : {
            user : 
            pass : 
        }
    })
    
}

const signUp = async (req,res) => {
    
    try {
        const {name,phone,email,password} = req.body;

        if(password !== confirmPassword){
            return res.render('signUp',{message : 'Password does not match'});
        }

        const findUser = await user.findOne({email})
        if(findUser){
            return res.render('signUp',{message : 'User email already existed'});
        }

        const otp = generateOtp();
        const emailSend = await sendVerificationEmail(email,otp);
    } catch (error) {
        console.error(' register not found'+error);
        return res.status(500).send('Something error');
    }
}



module.exports = {
    loadHomepage,
    pageNotFound,
    loadSignUp,
    signUp
}