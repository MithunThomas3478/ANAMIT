const  User = require('../models/userSchema');

// const userAuth = (req,res,next)=>{
//     if(req.session.user){
//         User.findById(req.session.user,req.session.passport.user)
//         .then(data=>{
//             if(data && !data.isBlocked){
//                 next();
//             }else{
//                 res.redirect('/login')
//             }
//         })
//         .catch(error=>{
//             console.log('Error in your auth middlerware');
//             res.status(500).send('Internal Serve error')
//         })
        
//     }else{
//         res.redirect('/login')
//     }
// }
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

module.exports = {
    userAuth,
    adminAuth
}