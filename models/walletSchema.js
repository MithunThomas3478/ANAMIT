const mongoose = require('mongoose');
const { Schema } = mongoose;

const transactionSchema = new Schema({
    type: {
        type: String,
        enum: ['credit', 'debit'],
        required: true
    },
    amount: {
        type: Number,
        required: true,
        min: 0
    },
    orderId: {
        type: Schema.Types.ObjectId,
        ref: 'Order',
        required: false  // Not required for non-order transactions like refunds or rewards
    },
    description: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'failed', 'reversed'],
        default: 'pending'
    },
    reference: {
        type: String,  // For tracking external references (e.g., refund IDs, reward IDs)
        required: false
    },
    metadata: {
        reason: String,  // e.g., 'order_payment', 'refund', 'cashback', 'reward'
        refundDetails: {
            originalTransactionId: Schema.Types.ObjectId,
            reason: String
        }
    }
}, {
    timestamps: true
});

const walletSchema = new Schema({
    user: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    balance: {
        type: Number,
        default: 0,
        min: 0
    },
    isActive: {
        type: Boolean,
        default: true
    },
    transactions: [transactionSchema],
    lastUpdated: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Virtual for calculating total credits
walletSchema.virtual('totalCredits').get(function() {
    return this.transactions
        .filter(t => t.type === 'credit' && t.status === 'completed')
        .reduce((sum, t) => sum + t.amount, 0);
});

// Virtual for calculating total debits
walletSchema.virtual('totalDebits').get(function() {
    return this.transactions
        .filter(t => t.type === 'debit' && t.status === 'completed')
        .reduce((sum, t) => sum + t.amount, 0);
});

// Method to add money to wallet
walletSchema.methods.credit = async function(amount, description, metadata = {}) {
    if (amount <= 0) throw new Error('Credit amount must be positive');
    
    const transaction = {
        type: 'credit',
        amount,
        description,
        status: 'completed',
        metadata
    };
    
    this.balance += amount;
    this.transactions.push(transaction);
    this.lastUpdated = new Date();
    
    return this.save();
};

// Method to deduct money from wallet
walletSchema.methods.debit = async function(amount, description, orderId = null, metadata = {}) {
    if (amount <= 0) throw new Error('Debit amount must be positive');
    if (this.balance < amount) throw new Error('Insufficient balance');
    
    const transaction = {
        type: 'debit',
        amount,
        description,
        orderId,
        status: 'completed',
        metadata
    };
    
    this.balance -= amount;
    this.transactions.push(transaction);
    this.lastUpdated = new Date();
    
    return this.save();
};

// Method to check if wallet has sufficient balance
walletSchema.methods.hasSufficientBalance = function(amount) {
    return this.balance >= amount;
};

// Method to get transaction history with pagination
walletSchema.methods.getTransactionHistory = async function(page = 1, limit = 10) {
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    
    return this.transactions
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(startIndex, endIndex);
};

// Pre-save middleware to validate balance
walletSchema.pre('save', function(next) {
    if (this.balance < 0) {
        next(new Error('Wallet balance cannot be negative'));
    } else {
        next();
    }
});

const Wallet = mongoose.model('Wallet', walletSchema);
module.exports = Wallet;