const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const UserSchema = new Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  phone: {
    type: String,
    required: false,
    unique: true,
    trim: true,
    sparse: true,
    default: null
  },
  googleId: {
    type:String,
    unique: true
  },
  password: {
     type: String,
     required : false
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  isAdmin :{
    type :Boolean,
    default : false
  },
  isBlock : {
    type : Boolean,
    default : false
  }
 
});


const user =  mongoose.model('User', UserSchema);

module.exports = user