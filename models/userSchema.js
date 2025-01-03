

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: {
      type: String,
      required: true
    },
    email: {
      type: String,
      required: true,
      unique: true
    },
    phone: {
      type: String
    },
    password: {
      type: String
    },
    authProvider: {
      type: String,
      enum: ['local', 'google'],
      required: true,
      default: 'local'
    },
    isBlocked: {
      type: Boolean,
      required: true,
      default: false
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
});

module.exports = mongoose.model('User', userSchema);


