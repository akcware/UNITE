const express = require("express");
const bodyParser = require("body-parser");
const router = express.Router();
const isAuth = require("../middleware/is-auth-supplier");
const sessionExit = require("../middleware/session-exit");
const supplierController = require("../controllers/supplier");
router.use(bodyParser.json());
router.use(bodyParser.urlencoded({ extended: true }));

router.get("/", isAuth, sessionExit, supplierController.getIndex);
router.get("/sign-in", supplierController.getSignIn);
router.get("/sign-up", supplierController.getSignUp);
router.get("/profile", isAuth, sessionExit, supplierController.getProfile);
router.get("/bid-requests", isAuth, sessionExit, supplierController.getBidRequests);
router.get("/bid-requests/:id", isAuth, sessionExit, supplierController.getBidRequest);
router.get("/balance", isAuth, sessionExit, supplierController.getBalance);
router.get("/forgotPassword", isAuth, sessionExit, supplierController.getForgotPassword);
router.get("/resetPassword/:token", isAuth, sessionExit, supplierController.getResetPasswordToken);

router.post("/sign-in", supplierController.postSignIn);
router.post("/sign-up", supplierController.postSignUp);
router.post("/profile", isAuth, sessionExit, supplierController.postProfile);
router.post("/bid-requests/:id", isAuth, sessionExit, supplierController.postBidRequest);
router.post('/confirmation', supplierController.postConfirmation);
router.post('/resend', supplierController.postResendToken);
router.post("/forgotPassword", isAuth, sessionExit, supplierController.postForgotPassword);
router.post("/resetPassword/:token", isAuth, sessionExit, supplierController.postResetPasswordToken);

module.exports = router;