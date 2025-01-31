const Wallet = require('../../models/walletSchema');
const { validationResult } = require('express-validator');
const crypto = require('crypto');

// Validation middleware
const validateAddMoney = (req, res, next) => {
    const { amount, paymentMethod } = req.body;

    if (!amount || isNaN(amount)) {
        return res.status(400).json({ 
            success: false,
            error: 'Invalid amount' 
        });
    }

    const parsedAmount = parseFloat(amount);
    if (parsedAmount < 100) {
        return res.status(400).json({ 
            success: false,
            error: 'Minimum amount should be ₹100' 
        });
    }

    if (!['upi', 'card', 'netbanking'].includes(paymentMethod)) {
        return res.status(400).json({ 
            success: false,
            error: 'Invalid payment method' 
        });
    }

    next();
};

const addMoney = async (req, res) => {
    try {
        const { amount, paymentMethod } = req.body;
        const parsedAmount = parseFloat(amount);

        // Find existing wallet
        let wallet = await Wallet.findOne({ user: req.user._id });

        // Create new wallet if doesn't exist
        if (!wallet) {
            try {
                // Generate unique wallet ID
                const walletId = await Wallet.generateWalletId();

                // Create new wallet with all necessary default values
                wallet = new Wallet({
                    user: req.user._id,
                    walletId: walletId,
                    balance: 0,
                    status: 'active',
                    type: 'personal',
                    limits: {
                        dailyTransactionLimit: 50000,
                        monthlyTransactionLimit: 500000,
                        minTransactionAmount: 1
                    },
                    transactions: [],
                    transactionLimits: {
                        dailyTotal: 0,
                        monthlyTotal: 0,
                        lastUpdated: new Date()
                    }
                });

                // Save the new wallet
                await wallet.save();
            } catch (error) {
                console.error('Wallet Creation Error:', {
                    message: error.message,
                    stack: error.stack
                });
                return res.status(500).json({
                    success: false,
                    error: 'Failed to create wallet',
                    details: error.message
                });
            }
        }

        // Generate payment ID
        const paymentId = crypto.randomBytes(16).toString('hex');

        try {
            // Process wallet transaction
            const transaction = await wallet.processTransaction(
                'credit',
                parsedAmount,
                'Money added to wallet',
                'deposit'
            );

            // Return success response
            return res.status(200).json({
                success: true,
                message: 'Money added successfully',
                transaction: transaction,
                newBalance: wallet.balance
            });

        } catch (transactionError) {
            console.error('Transaction Error:', {
                message: transactionError.message,
                stack: transactionError.stack
            });

            return res.status(500).json({
                success: false,
                error: 'Failed to process transaction',
                details: transactionError.message
            });
        }

    } catch (error) {
        console.error('Unexpected Error:', {
            message: error.message,
            stack: error.stack
        });

        return res.status(500).json({
            success: false,
            error: 'Unexpected error occurred',
            details: error.message
        });
    }
};

const getWalletPage = async (req, res) => {
    try {
        let wallet = await Wallet.findOne({ user: req.user._id });

        if (!wallet) {
            return res.render('userWallet', {
                user: req.user,
                wallet: { balance: 0, transactions: [] },
                activePage: 'wallet',
                error: req.flash('error'),
                success: req.flash('success')
            });
        }

        // Get filtered transactions
        const filters = {
            type: req.query.type !== 'all' ? req.query.type : undefined,
            startDate: req.query.dateRange ? getDateRangeStart(req.query.dateRange) : undefined,
            endDate: new Date(),
            page: parseInt(req.query.page) || 1,
            limit: 10
        };

        const transactionHistory = await wallet.getTransactionHistory(filters);

        res.render('userWallet', {
            user: req.user,
            wallet: {
                ...wallet.toObject(),
                transactions: transactionHistory.transactions
            },
            pagination: transactionHistory,
            activePage: 'wallet',
            error: req.flash('error'),
            success: req.flash('success')
        });
    } catch (error) {
        console.error('Error fetching wallet:', error);
        res.status(500).render('error', { 
            message: 'Error loading wallet',
            error: error.message 
        });
    }
};

// Export controller functions
module.exports = {
    validateAddMoney,
    addMoney,
    getWalletPage
};