const  User = require('../models/userSchema');


const userAuth = (req, res, next) => {
    if (req.session.user) {
      User.findById(req.session.user)
        .then((user) => {
          if (user && !user.isBlocked) {
            next(); // Allow access
          } else {
            req.session.destroy(); // Destroy session if user is blocked
            res.redirect('/login?error=blocked'); // Redirect to login with an error
          }
        })
        .catch((error) => {
          console.error('Error in userAuth middleware:', error);
          res.status(500).send('Internal Server Error');
        });
    } else {
      res.redirect('/login');
    }
  };
  

  

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