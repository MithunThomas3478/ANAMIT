const express = require('express');
const app = express();
const path = require('path');
const session = require('express-session');
const MongoStore = require('connect-mongo'); 
const flash = require('connect-flash');
const passport = require('./config/passport');
const env = require('dotenv').config();
const db = require('./config/db');
const http = require('http');
const socketIO = require('socket.io');
const userRouter = require('./routes/userRouter');
const adminRouter = require('./routes/adminRouter');

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.IO
const io = socketIO(server);

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('A user connected');

    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

// Make io accessible to our router
app.set('socketio', io);

// Initialize database connection
db();

// Middleware for parsing requests
app.use(express.json());
app.use(express.urlencoded({extended: true}));

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: process.env.MONGODB_URI || 'mongodb://localhost:27017/your-database-name',
        ttl: 24 * 60 * 60, // Session TTL (1 day)
        autoRemove: 'native' // Enable automatic removal of expired sessions
    }),
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // Cookie expiry (1 day)
    }
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Flash messages
app.use(flash());

// Make flash messages available to all views
app.use((req, res, next) => {
    res.locals.messages = req.flash();
    next();
});

// Disable caching
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    next();
});

// Make user data available to all views
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

// View engine setup
app.set('view engine', 'ejs');
app.set('views', [
    path.join(__dirname, 'views'),
    path.join(__dirname, 'views/user'),
    path.join(__dirname, 'views/admin')
]);

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/admin', adminRouter);
app.use('/', userRouter);

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).render('error', {
        message: 'Something went wrong!',
        error: process.env.NODE_ENV === 'development' ? err : {}
    });
});

// Port configuration
const PORT = process.env.PORT || 3478;
server.listen(PORT, () => {
    console.log(`ANAMIT Server is Running on ${PORT}`);
});

module.exports = { app, io };