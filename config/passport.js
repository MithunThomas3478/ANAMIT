const passport = require('passport')
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/userSchema');
const { name } = require('ejs');
const env = require('dotenv').config()

passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.CALLBACK_URL,
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
            let user = await User.findOne({ email: profile.emails[0].value });
    
            if (!user) {
                // Create a new Google user if not found
                user = new User({
                    name: profile.displayName,
                    email: profile.emails[0].value,
                    authProvider: 'google',
                    createdAt: Date.now()
                });
                await user.save();
            }
    
            // Check if user is blocked
            if (user.isBlocked) {
                return done(null, false, { message: 'User is blocked by admin' });
            }
    
            return done(null, user);
        } catch (error) {
            console.error('Google Strategy Error:', error);
            done(error, false);
        }
    }));
  




    passport.serializeUser((user, done) => {
      done(null, user.id); // Store user ID in the session
  });
  
  passport.deserializeUser(async (id, done) => {
      try {
          const user = await User.findById(id); // Fetch user from the database
          done(null, user);
      } catch (error) {
          done(error, null);
      }
  });
  

module.exports = passport;
