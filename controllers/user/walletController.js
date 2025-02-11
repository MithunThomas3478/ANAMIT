const Wallet = require('../../models/walletSchema');
const Razorpay = require('razorpay');
const crypto = require('crypto');

// Initialize Razorpay
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});


    // Get wallet page with transactions
 const getWalletPage = async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = 6; // Items per page
            
            // Find or create wallet for user
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

            // Calculate pagination
            const totalTransactions = wallet.transactions.length;
            const totalPages = Math.ceil(totalTransactions / limit);
            const startIndex = (page - 1) * limit;
            const endIndex = startIndex + limit;

            // Get paginated transactions
            const paginatedTransactions = await wallet.getTransactionHistory(page, limit);

            // Set transactions to paginated results for rendering
            wallet.transactions = paginatedTransactions;

            res.render('wallet', {
                title: 'My Wallet',
                wallet,
                user: req.user,
                currentPage: page,
                totalPages,
                startIndex,
                endIndex,
                totalTransactions
            });

        } catch (error) {
            console.error('Error in getWalletPage:', error);
            res.status(500).render('error', {
                message: 'Failed to load wallet',
                error: process.env.NODE_ENV === 'development' ? error : {}
            });
        }
    }

    // Create Razorpay order
    const createOrder = async (req, res) => {
        try {
            const { amount } = req.body;
    
            // Validate amount
            if (!amount || amount < 100) {
                return res.status(400).json({
                    success: false,
                    message: 'Minimum amount should be ₹100'
                });
            }
    
            // Create shorter receipt ID (max 40 chars)
            // Format: w_timestamp_shortUserId
            const shortUserId = req.user._id.toString().slice(-6); // Take last 6 chars of user ID
            const timestamp = Date.now().toString().slice(-8); // Take last 8 digits of timestamp
            const receiptId = `w_${timestamp}_${shortUserId}`; // w_timestamp_userid format
    
            // Create Razorpay order
            const options = {
                amount: amount * 100, // Convert to paise
                currency: 'INR',
                receipt: receiptId,
                notes: {
                    userId: req.user._id.toString(),
                    type: 'wallet_recharge'
                }
            };
    
            const order = await razorpay.orders.create(options);
    
            res.status(200).json({
                success: true,
                order
            });
    
        } catch (error) {
            console.error('Error in createOrder:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to create payment order',
                error: process.env.NODE_ENV === 'development' ? error.error : undefined
            });
        }
    }

    // Verify Razorpay payment
   const verifyPayment = async (req, res) => {
        try {
            const {
                razorpay_order_id,
                razorpay_payment_id,
                razorpay_signature
            } = req.body;

            // Verify signature
            const body = razorpay_order_id + '|' + razorpay_payment_id;
            const expectedSignature = crypto
                .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
                .update(body)
                .digest('hex');

            if (expectedSignature !== razorpay_signature) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid payment signature'
                });
            }

            // Get payment details from Razorpay
            const payment = await razorpay.payments.fetch(razorpay_payment_id);
            
            // Convert amount from paise to rupees
            const amountInRupees = payment.amount / 100;

            // Find or create wallet
            let wallet = await Wallet.findOne({ user: req.user._id });
            if (!wallet) {
                wallet = new Wallet({
                    user: req.user._id,
                    balance: 0,
                    isActive: true
                });
            }

            // Check if payment is already processed
            const existingTransaction = wallet.transactions.find(
                t => t.metadata?.paymentId === razorpay_payment_id
            );

            if (existingTransaction) {
                return res.status(400).json({
                    success: false,
                    message: 'Payment already processed'
                });
            }

            // Create metadata for transaction
            const metadata = {
                reason: 'razorpay_recharge',
                paymentId: razorpay_payment_id,
                orderId: razorpay_order_id,
                timestamp: new Date(),
                paymentMethod: payment.method
            };

            // Add money to wallet
            await wallet.credit(
                amountInRupees,
                'Wallet recharge via Razorpay',
                metadata
            );

            res.status(200).json({
                success: true,
                message: 'Payment verified and wallet updated successfully',
                data: {
                    newBalance: wallet.balance,
                    transactionId: wallet.transactions[wallet.transactions.length - 1]._id
                }
            });

        } catch (error) {
            console.error('Error in verifyPayment:', error);
            res.status(500).json({
                success: false,
                message: 'Payment verification failed'
            });
        }
    }

    // Get transaction history
   const getTransactionHistory = async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const type = req.query.type;
            const startDate = req.query.startDate;
            const endDate = req.query.endDate;

            const wallet = await Wallet.findOne({ user: req.user._id });
            if (!wallet) {
                return res.status(404).json({
                    success: false,
                    message: 'Wallet not found'
                });
            }

            // Filter transactions
            let transactions = wallet.transactions;

            if (type) {
                transactions = transactions.filter(t => t.type === type);
            }

            if (startDate && endDate) {
                transactions = transactions.filter(t => {
                    const txDate = new Date(t.createdAt);
                    return txDate >= new Date(startDate) && txDate <= new Date(endDate);
                });
            }

            // Sort by date descending
            transactions.sort((a, b) => b.createdAt - a.createdAt);

            // Paginate results
            const totalTransactions = transactions.length;
            const totalPages = Math.ceil(totalTransactions / limit);
            const startIndex = (page - 1) * limit;
            const endIndex = startIndex + limit;
            const paginatedTransactions = transactions.slice(startIndex, endIndex);

            res.status(200).json({
                success: true,
                data: {
                    transactions: paginatedTransactions,
                    pagination: {
                        currentPage: page,
                        totalPages,
                        totalTransactions,
                        hasNextPage: page < totalPages,
                        hasPrevPage: page > 1
                    }
                }
            });

        } catch (error) {
            console.error('Error in getTransactionHistory:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch transaction history'
            });
        }
    }

    // Check wallet balance
   const checkBalance = async (req, res) => {
        try {
            const wallet = await Wallet.findOne({ user: req.user._id });
            
            if (!wallet) {
                return res.status(404).json({
                    success: false,
                    message: 'Wallet not found'
                });
            }

            res.status(200).json({
                success: true,
                data: {
                    balance: wallet.balance,
                    totalCredits: wallet.totalCredits,
                    totalDebits: wallet.totalDebits
                }
            });

        } catch (error) {
            console.error('Error in checkBalance:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch wallet balance'
            });
        }
    }

    // Deduct money from wallet (for purchases)
   const deductMoney = async (req, res) => {
        try {
            const { amount, orderId, description } = req.body;

            if (!amount || amount <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid amount'
                });
            }

            const wallet = await Wallet.findOne({ user: req.user._id });
            
            if (!wallet) {
                return res.status(404).json({
                    success: false,
                    message: 'Wallet not found'
                });
            }

            if (!wallet.hasSufficientBalance(amount)) {
                return res.status(400).json({
                    success: false,
                    message: 'Insufficient balance'
                });
            }

            const metadata = {
                reason: 'purchase',
                orderId,
                timestamp: new Date()
            };

            await wallet.debit(amount, description, orderId, metadata);

            res.status(200).json({
                success: true,
                message: 'Amount deducted successfully',
                data: {
                    newBalance: wallet.balance,
                    transactionId: wallet.transactions[wallet.transactions.length - 1]._id
                }
            });

        } catch (error) {
            console.error('Error in deductMoney:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to deduct money from wallet'
            });
        }
    }


module.exports = {
    getWalletPage,
    createOrder,
    verifyPayment,
    getTransactionHistory,
    checkBalance,
    deductMoney
}