const User = require('../../models/userSchema');
const Order = require('../../models/orderSchema')
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const moment = require('moment');


const pageerror = async (req,res) => {

    res.render('page_404')
    
}

const loadLogin = async     (req, res) => {
    console.log('Admin login page loaded');
    if (req.session.admin) {
        console.log('Admin already logged in. Redirecting to dashboard...');
        return res.redirect('/admin/dashboard');
    }
    res.render('logins', { message: null });
};

const adminLogin = async (req, res) => {
    try {
        console.log('Received POST request:', req.body); // Log form data
        const { email, password } = req.body;

        const admin = await User.findOne({ email, isAdmin: true });
        if (admin) {
            const passwordMatch = await bcrypt.compare(password, admin.password); // Use await!
            if (passwordMatch) {
                req.session.admin = admin._id;
                return res.redirect('/admin/dashboard');
            } else {
                return res.redirect('/admin/login?error=Invalid Password');
            }
        } else {
            return res.redirect('/admin/login?error=Admin Not Found');
        }
    } catch (error) {
        console.error('Admin login error:', error.message);
        return res.redirect('/admin/page_404');
    }
};




const loadDashboard = async (req, res) => {
    if (req.session.admin) {
        try {
            console.log('Rendering dashboard...');
            res.render('adminDashboard');
        } catch (error) {
            console.error('Error rendering dashboard:', error.message);
            res.redirect('/admin/page_404');
        }
    } else {
        console.log('Admin not logged in. Redirecting to login...');
        res.redirect('/admin/login');
    }
};

const logout = async (req,res) => {
    console.log('Logging out admin...')
  
    try {
        req.session.destroy(err=>{
           if(err){
            console.log('Error destroy session',err);
            return res.render('pageerror');
           } 
           res.redirect('/admin/login');
        })
    } catch (error) {
        console.log('unexpected error');
        return res.redirect('/admin/login');
    }
}





module.exports = {
    loadLogin,
    adminLogin,
    loadDashboard,
    pageerror,
    logout,
  
}

