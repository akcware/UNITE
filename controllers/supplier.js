const bcrypt = require("bcryptjs");
const Supplier = require("../models/supplier");
const Buyer = require("../models/buyer");
const BidRequest = require("../models/bidRequest");
const BidStatus = require("../models/bidStatus");
const ProductService = require("../models/productService");
const Capability = require("../models/capability");
const Industry = require("../models/industry");
const Message = require("../models/message");
const Token = require("../models/supplierToken");
const assert = require("assert");
const process = require("process");
const async = require("async");
const crypto = require('crypto');
//sgMail.setApiKey('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');
//process.env.SENDGRID_API_KEY = "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";
const MongoClient = require("mongodb").MongoClient;
const ObjectId = require("mongodb").ObjectId;
const URL = process.env.MONGODB_URI, BASE = process.env.BASE;
const { sendConfirmationEmail, sendCancellationEmail, sendInactivationEmail, resendTokenEmail, sendForgotPasswordEmail, sendResetPasswordEmail, sendCancelBidEmail, postSignInBody } = require('../public/templates');

const statusesJson = {
  BUYER_REQUESTED_BID: parseInt(process.env.BUYER_REQ_BID),
  WAIT_BUYER_PROCESS_INFO: parseInt(process.env.BUYER_PROC_INFO),
  BUYER_WANTS_FOR_PRICE: parseInt(process.env.BUYER_ACCEPT_PRICE),
  SUPP_STARTED_DELIVERY: parseInt(process.env.SUPP_START_DELIVERY),
  PAYMENT_DELIVERY_DONE: parseInt(process.env.PAYMENT_DELIVERY_DONE),
  SUPPLIER_CANCELS_BID: parseInt(process.env.SUPP_CANCEL_BID),
  BUYER_CANCELS_BID: parseInt(process.env.BUYER_CANCEL_BID)
};

exports.getIndex = (req, res) => {
  if (!req || !req.session) return false;
  const supplier = req.session.supplier;

  BidRequest.find({ supplier: supplier._id })
    .then(requests => {
      const requestsCount = requests.length;

      res.render("supplier/index", {
        supplier: supplier,
        requestsCount: requestsCount,
        successMessage: req.flash("success")
      });
    })
    .catch(console.error);
}


exports.getAddProduct = (req, res) => {
  res.render("supplier/addProduct", {
    supplierId: req.session.supplier._id
  });
}


exports.postAddProduct = (req, res) => {
  if (!req.body.productPrice) {
    console.error("Price is not valid, please correct it.");
    res.redirect("back");
  } else {
    const product = new ProductService({
      supplier: req.body._id,
      productName: req.body.productName,
      price: parseFloat(req.body.price),
      currency: req.body.currency ? req.body.currency : "EUR",
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    product
      .save()
      .then(() => {
        req.flash("success", "Product added successfully!");
        return res.redirect("/supplier/profile");
      })
      .catch(console.error);
  }
}


exports.getCancelBid = (req, res) => {
  res.render('supplier/cancelBid', {
    bidId: req.params.bidId,
    bidName: req.params.bidName,
    userType: req.params.userType,
    buyerName: req.params.buyerName,
    supplierName: req.params.supplierName,
    buyerEmail: req.params.buyerEmail,
    supplierEmail: req.params.supplierEmail
  });  
}


exports.postCancelBid = (req, res) => {
  //BidRequest.findOne({_id: req.params.bidId});
  try {
  MongoClient.connect(URL, {useUnifiedTopology: true}, async function(err, db) {
      if (err) {
        req.flash('error', err.message);
        throw err;
      }
    
      var dbo = db.db(BASE);
    
      try {
        await dbo.collection('bidcancelreasons').insertOne( {
          title: req.body.cancelTitle,
          userType: req.body.userType,
          reason: req.body.reason,
          userName: req.body.suppliersName,
          createdAt: Date.now()
        }, function(err, obj) {});
      }  
      catch(e) {
        console.error(e);
        req.flash('error', e.message);
      }
    
      await dbo.collection("bidrequests").updateOne({ _id: new ObjectId(req.body.bidId) }, { $set: {isCancelled: true, status: parseInt(process.env.SUPP_BID_CANCEL)} }, async function(err, resp) {
        if(err) {
          console.error(err.message);
          
          return res.status(500).send({ 
            msg: err.message 
          });         
        }
        
        await sendCancelBidEmail(req, req.body.buyersName, req.body.suppliersName, req.body.buyersEmail, req.body.suppliersEmail, 'Buyer ', 'Supplier ', req.body.reason);
        res.redirect('back');
      });
    
    db.close();
    });
  } catch {
    //res.redirect('/supplier/index');
  }  
}


exports.getConfirmation = (req, res) => {
  if(!req.session || !req.session.supplierId) {
    req.session = req.session? req.session : {};
    req.session.supplierId = req.params && req.params.token? req.params.token._userId : null;
  }
  
  res.render("supplier/confirmation", { token: req.params? req.params.token : null });
}

exports.getDelete = (req, res) => {
  res.render('supplier/delete', {id: req.params.id});
}

exports.getDeactivate = (req, res) => {
  res.render('supplier/deactivate', {id: req.params.id});
}

exports.getResendToken = (req, res) => {
  res.render("supplier/resend");
}


async function removeAssociatedBids(req, dbo, id) {
  var promise = BidRequest.find( { supplier: id } ).exec();
  await promise.then(async (bids) => {
    var complexReason = 'The Supplier deleted their account. More details:\n' + req.body.reason;

    for(var bid of bids) {//One by one.          
      try {
        await dbo.collection('bidcancelreasons').insertOne( {
          title: 'Account Deletion',//req.body.reasonTitle,
          userType: req.body.userType,
          reason: complexReason,
          userName: req.body.companyName,
          createdAt: Date.now()
        }, function(err, obj) {
          if(err) {
            req.flash('error', err.message);
            throw err;
          }
        });
      }  
      catch(e) {
        console.error(e);
        req.flash('error', e.message);
        throw e;
      }

      await dbo.collection('bidrequests').deleteOne( { _id: bid._id }, function(err, obj) {
        if(err) {
          req.flash('error', err.message);
          throw err;
        }
      });

      req.body.requestsName = bid.requestName;
      await sendCancelBidEmail(req, bid.buyersName, bid.suppliersName, bid.buyersEmail, bid.suppliersEmail, 'Buyer ', 'Supplier ', complexReason);
    }
  });
}


exports.postDelete = function (req, res, next) {  
  var id = req.body.id;
  try {
    //Delete Supplier's Capabilities first:
    MongoClient.connect(URL, {useUnifiedTopology: true}, async function(err, db) {
      var dbo = db.db(BASE);
      
      try{
        await dbo.collection('usercancelreasons').insertOne( {
          title: req.body.reasonTitle,
          reason: req.body.reason,
          userType: req.body.userType,
          userName: req.body.companyName,
          createdAt: Date.now()
        }, function(err, obj) {});
      } catch(e) {
        console.error(e);
        req.flash('error', e.message);
      }
      
      await dbo.collection('capabilities').deleteMany({ supplier: id }, function(err, resp) {
        if(err) {
          req.flash('error', err.message);
          throw err;
        }
      });
        
      //Products/Services offered:
      await dbo.collection('productservices').deleteMany({ supplier: id }, function(err, resp0) {
        if(err) {
            req.flash('error', err.message);
            throw err;
          }
      });

      //Now delete the messages sent/received by Supplier:
      await dbo.collection('messages').deleteMany({ $or: [ { from: id }, { to: id } ] }, function(err, resp1) {
        if(err) {
          req.flash('error', err.message);
          throw err;
        }
      });
    
      //The received bids:
      await removeAssociatedBids(req, dbo, id);
            
      //Remove the possibly existing Supplier Tokens:
      await dbo.collection('suppliertokens').deleteMany({ _userId: id }, function(err, resp3) {
        if(err) {
          req.flash('error', err.message);
          throw err;
        }
      });

      //And now, remove the Supplier themselves:
      await dbo.collection('suppliers').deleteOne({ _id: id }, function(err, resp4) {
        if(err) {
          req.flash('error', err.message);
          throw err;
        }
      });

      //Finally, send a mail to the ex-Supplier:
      sendCancellationEmail('Supplier', req, 'received orders, products/services offered, listed capabilities, sent/received messages', req.body.reason);
      db.close();
      req.flash('success', 'You have deleted your Supplier account. We hope that you will be back with us!');
      return res.redirect("/supplier/sign-in");
    });
  } catch {
  }
}


exports.postDeactivate = function (req, res, next) {  
  var id = req.body.id;
  try {
    //Delete Supplier's Capabilities first:
    MongoClient.connect(URL, {useUnifiedTopology: true}, async function(err, db) {
      var dbo = db.db(BASE);
      /*
      try {
        await dbo.collection('cancelreasons').insertOne( {//To replace with a possible InactivationReason.
          type: req.body.type,
          reason: req.body.reason,
          userType: req.body.userType,
          userName: req.body.companyName,
          createdAt: Date.now()
        }, function(err, obj) {});
      } catch(e) {
        console.error(e);
      }*/
      
      await dbo.collection('capabilities').deleteMany({ supplier: id }, function(err, resp) {
        if(err) {
          req.flash('error', err.message);
          throw err;
        }
      });
        
      //Products/Services offered:
      await dbo.collection('productservices').deleteMany({ supplier: id }, function(err, resp0) {
        if(err) {
            req.flash('error', err.message);
            throw err;
          }
      });    
    
      //The received bids:
      await removeAssociatedBids(req, dbo, id);

      //And now, remove the Supplier themselves:
      await dbo.collection('suppliers').updaeOne( { _id: id }, { $set: { isActive: false } }, function(err, resp4) {
        if(err) {
          req.flash('error', err.message);
          throw err;
        }
      });

      //Finally, send a mail to the ex-Supplier:
      await sendCancellationEmail('Supplier', req, 'received orders, products/services offered, listed capabilities', req.body.reason);
      db.close();
      req.flash('success', 'You have deactivated your Supplier account. Logging in will reactivate you.');
      return res.redirect("/supplier/sign-in");
    });
  } catch {
    //res.redirect("/supplier");
  }
}


exports.postConfirmation = async function(req, res, next) {
  //assert("token", "Token cannot be blank").notEmpty();
  //req.sanitize("emailAddress").normalizeEmail({ remove_dots: false });
  //var errors = req.validationErrors();
  //if (errors) return res.status(400).send(errors);  

  await Token.findOne({ token: req.params.token }, async function(err, token) {
    if (!token) {
      req.flash(
        'error', "We were unable to find a valid token. It may have expired. Please request a new confirmation token."
      );
  
      res.redirect("/supplier/resend");
    }
  
    await Supplier.findOne({ _id: token._userId, emailAddress: req.body.emailAddress }, async function (err, user) {
      if (!user) 
        return res.status(400).send({
        msg: 'We were unable to find a user for this token.' 
      });

      if (user.isVerified) 
        return res.status(400).send({ 
        type: 'already-verified', 
        msg: 'This user has already been verified.' });
      

      await MongoClient.connect(URL, {useUnifiedTopology: true}, async function(err, db) {//db or client.
        if (err) {
          req.flash('error', err.message);
          throw err;
        }
        
        var dbo = db.db(BASE);
            
        await dbo.collection("suppliers").updateOne({ _id: user._id }, { $set: { isVerified: true, isActive: true } }, function(err, resp) {
              if(err) {
                res.status(500).send(err.message);
              }
        });

        console.log("The account has been verified. Please log in.");
        req.flash('success', "The account has been verified. Please log in.");
        db.close();
        res.status(200).send("The account has been verified. Please log in.");
      });
    });         
  });
}


exports.postResendToken = function(req, res, next) {
  Supplier.findOne({ emailAddress: req.body.emailAddress }, function(err, user) {
    if (!user)
      return res
        .status(400)
        .send({ msg: "We were unable to find a user with that email." });
    if (user.isVerified)
      return res.status(400).send({
        msg: "This account has already been verified. Please log in."
      });

    var token = new Token({
      _userId: user._id,
      token: crypto.randomBytes(16).toString("hex")
    });

    // Save the token
    token.save(async function(err) {
      if (err) {
        return res.status(500).send({ msg: err.message });
      }

      await resendTokenEmail(user, token.token, '/supplier/confirmation/', req);
      return res.status(200).send('A verification email has been sent to ' + user.emailAddress + '.');
    });
  });
}


exports.getSignIn = (req, res) => {
  if (!req.session.supplierId || !req.session.supplier.isVerified) {
    return res.render("supplier/sign-in", {
      errorMessage: req.flash("error")
    });
  } else 
    res.redirect("/supplier");
}


exports.postSignIn = async (req, res) => {
  postSignInBody('supplier', req, res);
}


exports.getSignUp = (req, res) => {
  if (!req.session.supplierId)
    return res.render("supplier/sign-up", {
      MAX_PROD: process.env.SUPP_MAX_PROD,
      errorMessage: req.flash("error")
    });
  else res.redirect("/supplier");
};


function prel(req, isNumber) {
  var arr = (req);
  arr = arr.split(',');
  var newProd = [];
  for (var i in arr) {
    newProd.push(isNumber? parseFloat(arr[i]) : String(arr[i]));
    }
  
  return newProd;
}


let global = 0;
exports.postSignUp = async (req, res) => {
  if (req.body.emailAddress) {
    const email = req.body.emailAddress;
    const email_str_arr = email.split("@");
    const domain_str_location = email_str_arr.length - 1;
    const final_domain = email_str_arr[domain_str_location];
    var prohibitedArray = ["gmaid.com", "hotmaix.com", "outloop.com", "yandex.com", "yahuo.com", "gmx"];

    for (var i = 0; i < prohibitedArray.length; i++)
      if (final_domain.toLowerCase().includes(prohibitedArray[i].toLowerCase())) {
        req.flash("error", "E-mail address must belong to a custom company domain.");
        res.redirect("back"); //supplier/sign-up
      } else {
        if (req.body.password.length < 6) {
          req.flash("error", "Password must have at least 6 characters.");
          res.redirect("back");
          var supplier;
          //Prevent duplicate attempts:
        } else if (global++ < 1) {
          await Supplier.findOne({ emailAddress: req.body.emailAddress }, function(err,  user) {
            if(err) {
              req.flash('error', err.message);
              throw err;
            }
            
            if (user)
              return res.status(400).send({
                msg:
                  "The e-mail address you have entered is already associated with another account."
              });
          }).catch(console.error);
          
          try {
            await bcrypt.hash(req.body.password, 10, async function(err, hash) {
                supplier = new Supplier({
                  role: process.env.USER_REGULAR,
                  avatar: req.body.avatar,
                  companyName: req.body.companyName,
                  directorsName: req.body.directorsName,
                  contactName: req.body.contactName,
                  title: req.body.title,
                  companyRegistrationNo: req.body.companyRegistrationNo,
                  emailAddress: req.body.emailAddress,
                  password: req.body.password,
                  isVerified: false,
                  isActive: false,
                  registeredCountry: req.body.registeredCountry,
                  companyAddress: req.body.companyAddress,
                  areaCovered: req.body.areaCovered,
                  contactMobileNumber: req.body.contactMobileNumber,
                  country: req.body.country,
                  industry: req.body.industry,
                  employeeNumbers: req.body.employeeNumbers,
                  lastYearTurnover: req.body.lastYearTurnover,
                  website: req.body.website,
                  productsServicesOffered: prel(req.body.productsServicesOffered),
                  pricesList: prel(req.body.pricesList, true),
                  currenciesList: prel(req.body.currenciesList),
                  capabilityDescription: req.body.capabilityDescription,
                  relevantExperience: req.body.relevantExperience,
                  supportingInformation: req.body.supportingInformation,
                  certificates: req.body.certificates,
                  antibriberyPolicy: req.body.antibriberyPolicy,
                  environmentPolicy: req.body.environmentPolicy,
                  qualityManagementPolicy: req.body.qualityManagementPolicy,
                  occupationalSafetyAndHealthPolicy: req.body.occupationalSafetyAndHealthPolicy,
                  otherRelevantFiles: req.body.otherRelevantFiles,
                  balance: req.body.balance,
                  facebookURL: req.body.facebookURL,
                  instagramURL: req.body.instagramURL,
                  twitterURL: req.body.twitterURL,
                  linkedinURL: req.body.linkedinURL,
                  otherSocialMediaURL: req.body.otherSocialMediaURL,
                  UNITETermsAndConditions: true,//We assume that user was constrainted to check them.
                  antibriberyAgreement: true,
                  createdAt: Date.now(),
                  updatedAt: Date.now()
                });

                await supplier.save(async (err) => {
                  if (err) {
                    //req.flash('error', err.message);
                    console.error(err);
                     return res.status(500).send({
                         msg: err.message
                         });
                  }
                });
                  
                  req.session.supplier = supplier;
                  req.session.supplierId = supplier._id;
                  await req.session.save();
                  
                  var capability = new Capability({
                    supplier: supplier._id,
                    capabilityDescription: supplier.capabilityDescription,
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                  });

                  await capability.save(function(err) {
                    if(err) {
                      req.flash('error', err.message);
                      console.error(err.message);
                      throw err;
                      }
                    
                    console.log('Capability saved!');
                  });
                  
                  var token = new Token({
                    _userId: supplier._id,
                    token: crypto.randomBytes(16).toString("hex")
                  });
                  
                  await token.save(async function(err) {
                    if (err) {
                      req.flash('error', err.message);
                      console.error(err.message);
                      return res.status(500).send({
                        msg: err.message
                       });
                        }
                  });
              
                  var industry = new Industry({
                    name: req.body.industry
                  });
              
                  industry.save((err) => {
                    req.flash('error', err.message);
                    console.error(err.message);//If that industry already exists.
                  });
                    
                    await sendConfirmationEmail(supplier.companyName, "/supplier/confirmation/", token.token, req);
                   
                    if (Array.isArray(supplier.productsServicesOffered)) {
                      for (var i in supplier.productsServicesOffered) {
                        var productService = new ProductService({
                          supplier: supplier._id,
                          productName: supplier.productsServicesOffered[i],
                          price: parseFloat(supplier.pricesList[i]),
                          currency: supplier.currenciesList[i],
                          createdAt: Date.now(),
                          updatedAt: Date.now()
                        });

                        await productService.save((err) => {
                          if (err) {
                            req.flash('error', err.message);
                            console.error(err.message);
                            throw err;
                          }
                        });
                      }                      
                    console.log('All products saved!');
                    }
              
              req.flash("success", "Supplier signed up successfully! Please confirm your account by visiting " + req.body.emailAddress + '');
              setTimeout(function() {
                  res.redirect("/supplier/sign-in");
                }, 150);
            });
       } catch {              
       }
      }
    }
  }
}


exports.getForgotPassword = (req, res) => {
  res.render("supplier/forgotPassword", {
    email: req.session.supplier.emailAddress
  });
}


exports.getChatLogin = (req, res) => {//We need a username, a room name, and a socket-based ID.
  res.render("supplier/chatLogin", {
    from: req.params.supplierId,
    to: req.params.buyerId,
    fromName: req.params.supplierName,
    toName: req.params.buyerName,
    reqId: req.params.requestId? req.params.requestId : 0,
    reqName: req.params.requestName? req.params.requestName : 'None'
  });
}


exports.getChat = (req, res) => {//Coming from the getLogin above.
  res.render("supplier/chat", {
    from: req.params.from,
    to: req.params.to,
    username: req.params.username,
    room: req.params.room,
    fromName: req.params.fromName,
    toName: req.params.toName,
    reqId: req.params.reqId,
    reqName: req.params.reqName
  });
}


exports.postForgotPassword = (req, res, next) => {
  async.waterfall(
    [
      function(done) {
        crypto.randomBytes(20, function(err, buf) {
          var token = buf.toString("hex");
          done(err, token);
        });
      },
      function(token, done) {
        Supplier.findOne({ emailAddress: req.body.emailAddress }, function (err, user) {
          if (!user) {
            req.flash('error', 'Sorry. We were unable to find a user with this e-mail address.');
            return res.redirect('supplier/forgotPassword');
          }

          MongoClient.connect(URL, {useUnifiedTopology: true}, function(err, db) {
            if (err) {
              req.flash('error', err.message);
              throw err;
            }
            
            var dbo = db.db(BASE);
            dbo.collection("suppliers").updateOne({ _id: user._id }, { $set: {resetPasswordToken: token, resetPasswordExpires: Date.now() + 86400000} }, function(err, resp) {        
              if(err) {
                console.error(err.message);
                req.flash('error', err.message);
                throw err;
              }

              db.close();
            });
          });
        });
      },
      function(token, user, done) {
        sendForgotPasswordEmail(user, 'Supplier', "/supplier/reset/", token, req);
      }
    ],
    function(err) {
      if (err) 
        return next(err);
      res.redirect("/supplier/forgotPassword");
    });
};

exports.getResetPasswordToken = (req, res) => {
  Supplier.findOne({
      resetPasswordToken: req.params.token,
      resetPasswordExpires: { $gt: Date.now() }
    }, function(err, user) {
      if (!user) {
        req.flash("error", "Password reset token is either invalid or expired.");
        return res.redirect("supplier/forgotPassword");
      }
      res.render("supplier/resetPassword", { token: req.params.token });
    });
};

exports.postResetPasswordToken = (req, res) => {
  async.waterfall([
    function(done) {
      Supplier.findOne({resetPasswordToken: req.params.token, 
                     resetPasswordExpires: { $gt: Date.now() }
                    }, function(err, user) {
      if(!user) {
        req.flash('error', 'Password reset token is either invalid or expired.');
        return res.redirect('back');
      }
        
    if(req.body.password === req.body.confirm) {
        MongoClient.connect(URL, {useUnifiedTopology: true}, function(err, db) {
          if (err) {
            req.flash('error', err.message);
            throw err;
          }
            
          var dbo = db.db(BASE);
          
          dbo.collection("suppliers").updateOne({ _id: user._id }, { $set: {password: req.body.password, resetPasswordToken: undefined, resetPasswordExpires: undefined} }, function(err, resp) {
            if(err) {
              console.error(err.message);
              req.flash('error', err.message);
              throw err;
            }

            db.close();
          });
        });
      } else {
        req.flash('error', 'Passwords do not match.');
        return res.redirect('back');
      }
    });
    },
      function(user, done) {
        sendResetPasswordEmail(user, 'Supplier', req);
      }
    ],
    function(err) {
      res.redirect("/supplier");
    }
  );
}


exports.getProfile = (req, res) => {
  if (!req || !req.session) return false;
  const supplier = req.session.supplier;

  ProductService.find({ supplier: supplier._id })
    .then( (products) => {
      req.session.supplier.productsServicesOffered = [];
    
      for(var i in products) {
        req.session.supplier.productsServicesOffered.push(products[i].productName);
      }
    
      res.render("supplier/profile", {
        products: products,
        MAX_PROD: process.env.SUPP_MAX_PROD,
        profile: req.session.supplier
      });
    })
    .catch(console.error);
}


exports.getBidRequests = (req, res) => {
  const supplier = req.session.supplier;

  BidRequest.find({ supplier: supplier._id })
    .then(requests => {
      res.render("supplier/bid-requests", {
        supplier: supplier,
        requests: requests
      });
    })
    .catch(console.error);
};

exports.getBalance = (req, res) => {
  res.render("supplier/balance", { balance: req.session.supplier.balance });
}


exports.getBidRequest = (req, res) => {
  const supplier = req.session.supplier;
  let request;
  const id = req.params.id;

  BidRequest.findOne({ _id: id })
    .then( (reqresult) => {
      request = reqresult;
      return Buyer.findOne({ _id: request.buyer });
    })
    .then((buyer) => {
    var promise = BidStatus.find({}).exec();
    promise.then((statuses) => {
      res.render("supplier/bid-request", {
        supplier: supplier,
        request: request,
        buyer: buyer,
        statuses: statuses,
        statusesJson: JSON.stringify(statusesJson)
        });
      });
    })
    .catch(console.error);
}


exports.postBidRequest = (req, res) => {
  MongoClient.connect(URL, {useUnifiedTopology: true}, async function(err, db) {
    if (err)  {
      req.flash('error', err.message);
      throw err;
    }
    
    var dbo = db.db(BASE);
    
    await dbo.collection("bidrequests").updateOne({ _id: req.body.reqId }, { $set: {status: req.body.status} }, function(err, res) {
      if(err) {
        console.error(err.message);
        req.flash('error', err.message);
        throw err;
      }
      
      req.flash('success', 'Bid status updated successfully!');
    });    
    db.close();
  });
  res.redirect('/supplier/index');
 }


exports.postProfile = async (req, res) => {
  global = 0;
  
  try {
  await Supplier.findOne({ _id: req.body._id }, async (err, doc) => {
    if (err) {
      console.error(err.message);
      req.flash('error', err.message);
      res.redirect("back");
    }

    doc._id = req.body._id;
    doc.avatar = req.body.avatar;
    doc.role = req.body.role;
    doc.companyName = req.body.companyName;
    doc.directorsName = req.body.directorsName;
    doc.contactName = req.body.contactName;
    doc.title = req.body.title;
    doc.emailAddress = req.body.emailAddress;
    doc.password = req.body.password;
    doc.isVerified = true;
    doc.isActive = true;
    doc.companyRegistrationNo = req.body.companyRegistrationNo;
    doc.registeredCountry = req.body.registeredCountry;
    doc.balance = req.body.balance;
    doc.companyAddress = req.body.companyAddress;
    doc.areaCovered = req.body.areaCovered;
    doc.contactMobileNumber = req.body.contactMobileNumber;
    doc.country = req.body.country;
    doc.industry = req.body.industry;
    doc.employeeNumbers = req.body.employeeNumbers;
    doc.lastYearTurnover = req.body.lastYearTurnover;
    doc.website = req.body.website;    
    doc.productsServicesOffered = prel(req.body.productsServicesOffered);
    doc.pricesList = prel(req.body.pricesList);
    doc.currenciesList = prel(req.body.currenciesList);
    doc.capabilityDescription = req.body.capabilityDescription;
    doc.relevantExperience = req.body.relevantExperience;
    doc.supportingInformation = req.body.supportingInformation;
    doc.certificates = req.body.certificates;
    doc.antibriberyPolicy = req.body.antibriberyPolicy;
    doc.environmentPolicy = req.body.environmentPolicy;
    doc.qualityManagementPolicy = req.body.qualityManagementPolicy;
    doc.occupationalSafetyAndHealthPolicy = req.body.occupationalSafetyAndHealthPolicy;
    doc.otherRelevantFiles = req.body.otherRelevantFiles;
    doc.facebookURL = req.body.facebookURL;
    doc.instagramURL = req.body.instagramURL;
    doc.twitterURL = req.body.twitterURL;
    doc.linkedinURL = req.body.linkedinURL;
    doc.otherSocialMediaURL = req.body.otherSocialMediaURL;
    doc.UNITETermsAndConditions = req.body.UNITETermsAndConditions == "on" ? true : false;
    doc.antibriberyAgreement = req.body.antibriberyAgreement == "on" ? true : false;
    doc.createdAt = req.body.createdAt;
    doc.updatedAt = Date.now();
    //doc.__v = 1;//Last saved version. To be taken into account for future cases of concurrential changes, in case updateOne does not protect us from that problem.
    var price = req.body.price;
    
    if(global++ < 1)
    await MongoClient.connect(URL, {useUnifiedTopology: true}, async function(err, db) {
      if (err) {
        req.flash('error', err.message);
        throw err;
      }
      var dbo = db.db(BASE);
      
      await dbo.collection("suppliers").updateOne({ _id: doc._id }, { $set: doc }, function(err, resp0) {
          if (err) {
            req.flash('error', err.message);
            console.error(err.message);
            throw err;
          }
        });

      console.log("Supplier updated!");
      var arr = doc.productsServicesOffered;
      await dbo.collection("capabilities").deleteMany({ supplier: doc._id }, (err, resp1) => {
        if(err) {
          req.flash('error', err.message);
          console.error(err.message);
          throw err;
        }
      });

        var capability = new Capability({
        supplier: doc._id,
        capabilityDescription: doc.capabilityDescription,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });

      await capability.save((err) => {
        if (err) {
          req.flash('error', err.message);
          console.error(err.message);
          throw err;
          }
      });
      
      var industry = new Industry({
        name: doc.industry
      });

      industry.save((err) => {
        if(err) {
          req.flash('error', err.message);
          console.error(err.message);//If that industry already exists.
          throw err;
        }
      });

      console.log('Capability description saved!');
      await dbo.collection("productservices").deleteMany({ supplier: doc._id }, (err, resp2) => {
        if(err) {
          req.flash('error', err.message);
          console.error(err.message);
          throw err;
        }
      });
      
      if (Array.isArray(arr))
        for (var i in arr) {
          if(!doc.pricesList[i]) 
            continue;

          var productService = new ProductService({
            supplier: doc._id,
            productName: arr[i],
            price: parseFloat(doc.pricesList[i]),
            currency: doc.currenciesList[i],
            createdAt: Date.now(),
            updatedAt: Date.now()
          });

          await productService.save((err) => {
            if (err) {
              req.flash('error', err.message);
              console.error(err.message);
              throw err;
            }
          });
          
          db.close();
          console.log('Product saved!');
        }
      });
      
    console.log('Products offered list saved! Now saving new data to session:');
    req.session.supplier = doc;
    req.session.supplierId = doc._id;

    await req.session.save((err) => {
      if(err) {
        req.flash('error', err.message);
        console.error(err.message);
        throw err;
      }
    });
    
    req.flash("success", "Supplier details updated successfully!");
    console.log("User updated and session saved!");
    setTimeout(function() {
      return res.redirect("/supplier/profile");
    }, 150); 
    })
    .catch(console.error);
  } catch {
    //res.redirect("/supplier/profile");
  }
};
