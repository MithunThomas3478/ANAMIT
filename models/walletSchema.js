const mongoose = require('mongoose');
const { Schema } = mongoose;

// Constants for transaction limits
const CONSTANTS = {
    MAX_DAILY_TRANSACTION_LIMIT: 50000,
    MAX_MONTHLY_TRANSACTION_LIMIT: 500000,
    MIN_TRANSACTION_AMOUNT: 1,
    MAX_TRANSACTION_RETRY: 3
};

// Wallet Schema
const walletSchema = new Schema({
    user: { 
        type: Schema.Types.ObjectId, 
        ref: 'User', 
        required: true 
    },
    walletId: { 
        type: String, 
        required: true,
        unique: true 
    },
    balance: {
        type: Number,
        required: true,
        default: 0,
        min: [0, 'Balance cannot be negative']
    },
    currency: { 
        type: String, 
        default: 'INR', 
        uppercase: true 
    },
    status: {
        type: String,
        enum: ['active', 'suspended', 'closed'],
        default: 'active'
    },
    type: {
        type: String,
        enum: ['personal', 'business'],
        default: 'personal'
    },
    limits: {
        dailyTransactionLimit: { 
            type: Number, 
            default: CONSTANTS.MAX_DAILY_TRANSACTION_LIMIT 
        },
        monthlyTransactionLimit: { 
            type: Number, 
            default: CONSTANTS.MAX_MONTHLY_TRANSACTION_LIMIT 
        },
        minTransactionAmount: { 
            type: Number, 
            default: CONSTANTS.MIN_TRANSACTION_AMOUNT 
        }
    },
    transactions: [{
        type: {
            type: String,
            enum: ['credit', 'debit', 'refund', 'reversal', 'adjustment'],
            required: true
        },
        amount: {
            type: Number,
            required: true,
            min: [CONSTANTS.MIN_TRANSACTION_AMOUNT, 'Amount must be positive']
        },
        balance: { 
            type: Number, 
            required: true 
        },
        description: { 
            type: String, 
            required: true 
        },
        status: {
            type: String,
            enum: ['pending', 'completed', 'failed', 'reversed', 'cancelled'],
            default: 'completed'
        },
        createdAt: { 
            type: Date, 
            default: Date.now 
        }
    }],
    transactionLimits: {
        dailyTotal: { 
            type: Number, 
            default: 0 
        },
        monthlyTotal: { 
            type: Number, 
            default: 0 
        },
        lastUpdated: { 
            type: Date, 
            default: Date.now 
        }
    },
    lastUpdated: { 
        type: Date, 
        default: Date.now 
    }
}, {
    timestamps: true,
    collection: 'wallets'
});

// Generate Wallet ID
walletSchema.statics.generateWalletId = async function() {
    try {
        const date = new Date();
        const prefix = 'W' + date.getFullYear().toString().substr(-2) +
                      (date.getMonth() + 1).toString().padStart(2, '0');
        
        const lastWallet = await this.findOne({}, { walletId: 1 }, { sort: { 'walletId': -1 } });
        let sequence = 1;
        
        if (lastWallet && lastWallet.walletId) {
            const lastId = lastWallet.walletId;
            sequence = parseInt(lastId.slice(-6)) + 1;
        }
        
        return `${prefix}${sequence.toString().padStart(6, '0')}`;
    } catch (error) {
        console.error('Error generating wallet ID:', error);
        throw new Error('Failed to generate wallet ID');
    }
};

// Process Transaction Method
walletSchema.methods.processTransaction = async function(type, amount, description, category = 'other', metadata = {}) {
    try {
        // Validate wallet status
        if (this.status !== 'active') {
            throw new Error(`Wallet is ${this.status}`);
        }

        // Ensure limits object exists
        if (!this.limits) {
            this.limits = {
                dailyTransactionLimit: CONSTANTS.MAX_DAILY_TRANSACTION_LIMIT,
                monthlyTransactionLimit: CONSTANTS.MAX_MONTHLY_TRANSACTION_LIMIT,
                minTransactionAmount: CONSTANTS.MIN_TRANSACTION_AMOUNT
            };
        }

        // Validate amount
        const minAmount = this.limits.minTransactionAmount || CONSTANTS.MIN_TRANSACTION_AMOUNT;
        if (amount < minAmount) {
            throw new Error(`Amount is below minimum transaction limit of ${minAmount}`);
        }

        // Ensure transactionLimits object exists
        if (!this.transactionLimits) {
            this.transactionLimits = {
                dailyTotal: 0,
                monthlyTotal: 0,
                lastUpdated: new Date()
            };
        }

        // Check transaction limits for debit transactions
        if (type === 'debit') {
            this.checkTransactionLimits(amount);
        }

        // Calculate new balance
        const newBalance = type === 'credit' || type === 'refund' 
            ? (this.balance || 0) + amount 
            : (this.balance || 0) - amount;

        // Check for negative balance
        if (newBalance < 0 && !this.settings?.allowNegativeBalance) {
            throw new Error('Insufficient balance');
        }

        // Create transaction
        const transaction = {
            type,
            amount,
            balance: newBalance,
            description,
            status: 'completed',
            createdAt: new Date()
        };

        // Update transaction limits for debit transactions
        if (type === 'debit') {
            this.transactionLimits.dailyTotal = (this.transactionLimits.dailyTotal || 0) + amount;
            this.transactionLimits.monthlyTotal = (this.transactionLimits.monthlyTotal || 0) + amount;
        }

        // Add transaction and update balance
        if (!this.transactions) {
            this.transactions = [];
        }
        this.transactions.push(transaction);
        this.balance = newBalance;
        this.lastUpdated = new Date();
        
        await this.save();
        return transaction;

    } catch (error) {
        // Detailed error logging
        console.error('Transaction Processing Error:', {
            message: error.message,
            stack: error.stack,
            type: error.name
        });

        throw error;
    }
};

// Check Transaction Limits
walletSchema.methods.checkTransactionLimits = function(amount) {
    // Ensure transactionLimits exists
    if (!this.transactionLimits) {
        this.transactionLimits = {
            dailyTotal: 0,
            monthlyTotal: 0,
            lastUpdated: new Date()
        };
    }

    const now = new Date();
    const lastUpdate = this.transactionLimits.lastUpdated;

    // Reset daily and monthly totals if needed
    if (now.getDate() !== lastUpdate.getDate()) {
        this.transactionLimits.dailyTotal = 0;
    }

    if (now.getMonth() !== lastUpdate.getMonth()) {
        this.transactionLimits.monthlyTotal = 0;
    }

    // Update last updated date
    this.transactionLimits.lastUpdated = now;

    // Check limits
    const dailyTotal = (this.transactionLimits.dailyTotal || 0) + amount;
    const monthlyTotal = (this.transactionLimits.monthlyTotal || 0) + amount;

    const dailyLimit = this.limits?.dailyTransactionLimit || CONSTANTS.MAX_DAILY_TRANSACTION_LIMIT;
    const monthlyLimit = this.limits?.monthlyTransactionLimit || CONSTANTS.MAX_MONTHLY_TRANSACTION_LIMIT;

    if (dailyTotal > dailyLimit) {
        throw new Error('Daily transaction limit exceeded');
    }

    if (monthlyTotal > monthlyLimit) {
        throw new Error('Monthly transaction limit exceeded');
    }
};

// Create the model
let Wallet;
try {
    Wallet = mongoose.model('Wallet');
} catch (error) {
    Wallet = mongoose.model('Wallet', walletSchema);
}

module.exports = Wallet;