const express = require('express');
const { requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/adminController');
const dashboard = require('../controllers/dashboardController');
const products = require('../controllers/productsController');
const sales = require('../controllers/salesController');

const router = express.Router();
router.use(requireRole('admin'));
router.use(ctrl.pendingRequestCount);

router.get('/dashboard', dashboard.dashboard);

router.get('/products', products.listProducts);
router.post('/products', products.createProduct);
router.get('/products/import-template.csv', products.importTemplate);
router.post('/products/import', products.importProducts);
router.get('/products/:id(\\d+)/image', products.productImage);
router.post('/products/:id(\\d+)/active', products.setProductActive);
router.post('/products/:id(\\d+)/delete', products.deleteProduct);
router.post('/products/:id(\\d+)', products.updateProduct);
router.post('/categories', products.createCategory);
router.post('/product-options', products.addOption);
router.post('/product-options/delete', products.removeOption);

router.get('/users', ctrl.listUsers);
router.post('/users', ctrl.createUser);
router.post('/users/:id(\\d+)/toggle-active', ctrl.toggleUserActive);
router.post('/users/:id(\\d+)/reset-password', ctrl.resetUserPassword);
router.post('/access-requests/:id/approve', ctrl.approveAccessRequest);
router.post('/access-requests/:id/reject', ctrl.rejectAccessRequest);
router.post('/password-resets/:id/resolve', ctrl.resolvePasswordReset);
router.post('/password-resets/:id/dismiss', ctrl.dismissPasswordReset);

router.get('/sales', sales.listSales);
router.get('/sales/export.csv', sales.exportSales);
router.get('/sales/:id(\\d+)', sales.viewSale);
router.post('/sales/:id(\\d+)/refund', sales.refundSale);

router.get('/inventory-reports', ctrl.listInventoryReports);

module.exports = router;
