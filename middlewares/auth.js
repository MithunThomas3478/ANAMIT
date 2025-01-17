const  User = require('../models/userSchema');


const userAuth = async (req, res, next) => {
  try {
    // Check for user ID in session, with proper type checking
    const userId = req.session?.user || req.session?.passport?.user;
    
    if (!userId) {
      return res.redirect('/login');
    }

    // Find user and handle potential null/undefined cases
    const user = await User.findById(userId);
    
    if (!user) {
      // User not found in database
      req.session.destroy((err) => {
        if (err) {
          console.error('Error destroying session:', err);
        }
      });
      return res.redirect('/login?error=invalid');
    }

    if (user.isBlocked) {
      // Handle blocked user
      req.session.destroy((err) => {
        if (err) {
          console.error('Error destroying session:', err);
        }
      });
      return res.redirect('/login?error=blocked');
    }

    // Attach user to request object for later use
    req.user = user;
    return next();

  } catch (error) {
    console.error('Error in userAuth middleware:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during authentication'
    });
  }
};

module.exports = userAuth;

  

const adminAuth = (req,res,next)=>{
    User.findOne({isAdmin:true})
    .then(data=>{
        if(data){
            next();
        }else{
            res.redirect('/admin/login')
        }
    })
    .catch(error=>{
        console.log('Error in adminauth middleware',error)
        res.status(500).send('InternalServer Error')
    })
}

const adminAuthMiddleware = (req, res, next) => {
  if (!req.session.admin) {
    
    return res.redirect('/admin/login?error=Please log in to access the admin panel');
  }
  console.log("admin session exists");
  next();   
};


module.exports = {
    userAuth,
    adminAuth,
    adminAuthMiddleware
}