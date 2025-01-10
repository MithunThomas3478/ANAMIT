        const mongoose = require('mongoose');
        const {Schema} = mongoose;


        const productSchema = new Schema({
            productName:{
                type:String,
                required:true
            },
            description:{
                type:String,
                required:true
            },
            category:{
                type:Schema.Types.ObjectId,
                ref:"Category",
                required:true,

            },  
            productOffer:{
                type:Number,
                default:0,
            },
            variants: [{
                color: {
                    type: String,
                    required: true
                },
                colorName:{
                    type:String,
                    required:true
                },
                size: {
                    type: String,
                    required: true
                },
                stock: {
                    type: Number,
                    required: true,
                    default: 0
                },
                price: {
                    type: Number,
                    required: true
                },
                productImage:{
                    type:[String],
                    required:true,
                },
                status:{
                    type:String,
                    enum:["Available","out of stock","discontinued"],
                    required:true,
                    default:"Available"
                },
            }],
            isBlocked:{
                type:Boolean,
                default:false
            },
        
            createdOn:{
                type:Date,
                default:Date.now,
            },
        },{timestamps:true});

        const product = mongoose.model("Product",productSchema);

        module.exports = product;