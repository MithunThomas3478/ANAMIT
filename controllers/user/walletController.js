const Wallet = require('../../models/walletSchema');


const getWalletPage = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 5;
        
        let wallet = await Wallet.findOne({ user: req.user._id });
        
        if (!wallet) {
            wallet = new Wallet({
                user: req.user._id,
                balance: 0,
                isActive: true,
                transactions: []
            });
            await wallet.save();
        }

        const totalTransactions = wallet.transactions.length;
        const totalPages = Math.ceil(totalTransactions / limit);
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;

        // Get paginated transactions using schema method
        const paginatedTransactions = await wallet.getTransactionHistory(page, limit);
        wallet.transactions = paginatedTransactions;

        res.render('wallet', {
            title: 'My Wallet',
            wallet,
            user: req.user,
            currentPage: page,
            totalPages,
            startIndex,
            endIndex,
            errors: req.flash('errors') || {}
        });

    } catch (error) {
        console.error('Error in getWalletPage:', error);
        res.status(500).render('error', {
            message: 'Something went wrong while loading your wallet',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
}

const addMoneyToWallet = async (req, res) => {
    try {
        // Get amount from request body
        const { amount } = req.body;
        
        // Input validation
        if (!amount || isNaN(amount)) {
            return res.status(400).json({
                success: false,
                message: 'Please provide a valid amount'
            });
        }

        // Convert amount to number and validate minimum amount
        const amountToAdd = Number(amount);
        if (amountToAdd < 100) {
            return res.status(400).json({
                success: false,
                message: 'Minimum amount should be ₹100'
            });
        }

        // Find user's wallet
        let wallet = await Wallet.findOne({ user: req.user._id });
        
        // Create wallet if it doesn't exist
        if (!wallet) {
            wallet = new Wallet({
                user: req.user._id,
                balance: 0,
                isActive: true,
                transactions: []
            });
        }

        // Check if wallet is active
        if (!wallet.isActive) {
            return res.status(400).json({
                success: false,
                message: 'Wallet is currently inactive'
            });
        }

        // Create metadata for the transaction
        const metadata = {
            reason: 'wallet_topup',
            timestamp: new Date(),
            ip: req.ip,
            userAgent: req.headers['user-agent']
        };

        // Add money to wallet using the credit method from schema
        await wallet.credit(
            amountToAdd,
            'Wallet money added',
            metadata
        );

        // Send success response
        return res.status(200).json({
            success: true,
            message: 'Money added successfully',
            data: {
                newBalance: wallet.balance,
                transactionId: wallet.transactions[wallet.transactions.length - 1]._id
            }
        });

    } catch (error) {
        console.error('Error in addMoneyToWallet:', error);
        
        // Send error response
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to add money to wallet',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
};

module.exports = {

    getWalletPage,
    addMoneyToWallet
}