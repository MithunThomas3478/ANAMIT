const Admin = require('../../models/userSchema');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');


const loadLogin = async (req,res) => {
    if(req.session.admin){
        return res.redirect('dashboard')
    }
    res.render('adminlogin',{message : null})
}



const adminLogin = async (req, res) => {
    const { email, password } = req.body;
    console.log('email: ', email);
    console.log('pass',password)

    // Basic email format validation
    const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,4}$/;
    if (!emailRegex.test(email)) {
        return res.render('adminlogin', { message: 'Invalid email format' });
    }

    try {
        // Find admin by email
        const findAdmin = await Admin.findOne({ email });

        if (!findAdmin) {
            return res.render('adminlogin', { message: 'Invalid email or password' });
        }

        // Check if the account is blocked
        if (findAdmin.isBlock) {
            return res.render('adminlogin', { message: 'This account is blocked. Please contact support' });
        }

        // Use bcrypt to compare the entered password with the stored hashed password
        const isMatch = await bcrypt.compare(password, findAdmin.password);
        if (!isMatch) {
            return res.render('adminlogin', { message: 'Invalid email or password' });
        }

        // Redirect to the dashboard (make sure session is handled)
        res.redirect('/dashboard');
    } catch (error) {
        console.error('Admin login error:', error.message);
        res.status(500).render('adminlogin', { message: 'Internal server error. Please try again later.' });
    }
};

const loadDashboard = async (req, res) => {
    // Render the dashboard view (ensure proper authorization for the user)
    res.render('dashboard');
};


module.exports = {
    loadLogin,
    adminLogin,
    loadDashboard
}