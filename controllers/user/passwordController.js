const User = require('../../models/userSchema');
const bcrypt = require('bcrypt');

const loadPasswordManager = async (req,res) => {
    try {

        const user = await User.findById(req.user._id);
        if (!user) {
            req.flash('error', 'User not found');
            return res.redirect('/userProfile');
        }

        res.render('userPasswordManagement',{
            user : req.user,
            message : {
                 success : req.flash("success"),
                 error : req.flash('error')
            }
        });
    } catch (error) {
        console.error('Error in getChangePassword:', error);
        req.flash('error', 'Something went wrong');
        res.redirect('/userProfile');
    }
    }

    const validatePassword = (password) => {
        return password.length >= 8 && 
               /[A-Z]/.test(password) && 
               /[a-z]/.test(password) && 
               /[0-9]/.test(password);
    };


    const changePassword = async (req, res) => {
        try {
            const user = await User.findById(req.user._id);
    
            if (!user || user.authProvider === 'google') {
                return res.json({
                    success: false,
                    message: 'Password change is not available for this account'
                });
            }
    
            const { currentPassword, newPassword, confirmPassword } = req.body;
    
            if (!validatePassword(newPassword)) {
                return res.json({
                    success: false,
                    message: 'New password does not meet requirements'
                });
            }
    
            if (newPassword !== confirmPassword) {
                return res.json({
                    success: false,
                    message: 'New passwords do not match'
                });
            }
    
            const isValidPassword = await bcrypt.compare(currentPassword, user.password);
            if (!isValidPassword) {
                return res.json({
                    success: false,
                    message: 'Current password is incorrect'
                });
            }
    
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(newPassword, salt);
    
            await User.findByIdAndUpdate(user._id, { password: hashedPassword });
    
            res.json({
                success: true,
                message: "Please log in again using your new password"
            });
    
        } catch (error) {
            console.error('Error in changePassword:', error);
            res.json({
                success: false,
                message: 'Something went wrong'
            });
        }
    };
    
    module.exports = {
        loadPasswordManager,
        changePassword
    }