const passport = require('passport')
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/userSchema');
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
                console.log('Google Profile:', profile); // Debug log
                
                if (!profile.emails || !profile.emails[0]) {
                    return done(new Error('No email found in Google profile'), null);
                }

                let user = await User.findOne({ email: profile.emails[0].value });

                if (!user) {
                    // Create a new Google user if not found
                    user = new User({
                        name: profile.displayName,
                        email: profile.emails[0].value,
                        authProvider: 'google',
                        createdAt: Date.now(),
                        isVerified: true // Google users are pre-verified
                    });
                    await user.save();
                    console.log('New Google user created:', user.email);
                }

                // Check if user is blocked
                if (user.isBlocked) {
                    console.log('Blocked user attempted login:', user.email);
                    return done(null, false, { message: 'User is blocked by admin' });
                }

                return done(null, user);
            } catch (error) {
                console.error('Google Strategy Error:', error);
                done(error, false);
            }
        }
    )
);

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const user = await User.findById(id);
        done(null, user);
    } catch (error) {
        console.error('Deserialize Error:', error);
        done(error, null);
    }
});

module.exports = passport;
