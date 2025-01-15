
const express = require('express');
const app = express();
const path = require('path');
const session = require('express-session');
const passport = require('./config/passport');
const env = require('dotenv').config();
const db = require('./config/db');
const userRouter = require('./routes/userRouter');
const adminRouter = require('./routes/adminRouter')
db();




app.use(express.json());
app.use(express.urlencoded({extended:true}));



app.use(session({
  secret: 'yourSecretKey',
  resave: false,
  saveUninitialized: true,
  cookie: {
      secure: false, // Set to true if you're using https
      httpOnly: true,
      maxAge: 60 * 60 * 1000 // 1 hour in milliseconds
    }
}));


  // Initialize Passport
app.use(passport.initialize());
app.use(passport.session());


app.use((req,res,next)=>{
  res.set('cache-control','no-store')
  next();
});
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

app.set('view engine','ejs');
app.set('views', [
    path.join(__dirname, 'views/user'),
    path.join(__dirname, 'views/admin')
  ]);

app.use(express.static(path.join(__dirname,'public')));  

app.use('/admin',adminRouter);
app.use('/',userRouter);

const PORT = 3478 || process.env.PORT
app.listen(process.env.PORT,()=>{
    console.log(`ANAMIT Server is Running on ${PORT} `)
});

module.exports = app;