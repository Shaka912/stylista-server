const admin = require("firebase-admin");
const express = require("express");
require("handlebars");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const engines = require("consolidate");
const tmp = require("tmp");
const fs = require("fs");
const { Storage } = require("@google-cloud/storage");
const bodyParser = require("body-parser");
const auth = require("./AuthMiddleware");
var jwt = require("jsonwebtoken");
const SECRET_KEY = process.env.SECRET_KEY;

const app = express();
app.engine("hbs", engines.handlebars);
app.set("views", "./views");
app.set("view engine", "hbs");

const serviceaccountkey = {
  type: process.env.type,
  project_id: process.env.project_id,
  private_key_id: process.env.private_key_id,
  private_key: process.env.private_key,
  client_email: process.env.client_email,
  client_id: process.env.client_id,
  auth_uri: process.env.auth_uri,
  token_uri: process.env.token_uri,
  auth_provider_x509_cert_url: process.env.auth_provider_x509_cert_url,
  client_x509_cert_url: process.env.client_x509_cert_url,
  universe_domain: process.env.universe_domain,
};

admin.initializeApp({
  databaseURL: process.env.databaseURL,
  storageBucket: process.env.storageBucket,
  credential: admin.credential.cert(serviceaccountkey),
});

const db = admin.database();
const fstore = admin.firestore();
const bucket = admin.storage().bucket();
const notification = admin.messaging();

app.listen(3000, () => {
  console.log("listening on", 3000);
});
app.get("/", (req, res) => {
  res.send("Hello World!");
});
app.use("/webhook", express.raw({ type: "application/json" }));
app.use(express.json());

const sendPassportToStripe = (userId, side) => {
  return new Promise((resolve) => {
    const tempFilePath = tmp.tmpNameSync();

    const storage = new Storage();

    const bucket = storage.bucket("gs://stylistasapp7.appspot.com");

    const file = bucket.file(`stripe_image/${userId}${side}`);

    file.download({ destination: tempFilePath }).then(async () => {
      const fp = fs.readFileSync(tempFilePath);

      const file = await stripe.files.create({
        purpose: "identity_document",
        file: {
          data: fp,
          name: `${side}.png`,
          type: "application/octet-stream",
        },
      });

      resolve(file);
    });
  });
};

app.post("/login", async (req, res) => {
  try {
    const { userid, role } = req.body;
    const data = {
      user: {
        id: userid,
        role: role,
      },
    };
    var token = jwt.sign(data, SECRET_KEY);
    return res.status(200).json({
      message: "User Login Success",
      data: {
        token: token,
      },
      status: 200,
    });
  } catch (error) {
    return response.status(400).json({
      message: "User Failed to Login",
      status: 400,
    });
  }
});

app.post("/createStripeAccount", auth, async (req, res) => {
  try {
    let {
      data,
      userId,
      cardToken,
      accountnumber,
      routingnumber,
      currency,
      type,
      country,
      account_type,
    } = req.body;

    // Upload passport images
    const frontPassport = await sendPassportToStripe(userId, "front");
    const backPassport = await sendPassportToStripe(userId, "back");

    data.individual.verification.document.front = frontPassport.id;
    data.individual.verification.document.back = backPassport.id;

    data.settings = {
      payouts: {
        schedule: {
          interval: "manual",
        },
      },
    };

    // Create the Stripe account
    const account = await stripe.accounts.create(data);

    // Handle bank or card accounts
    if (type === "bank") {
      const bank_account = {
        country: country,
        account_number: accountnumber,
        currency: currency,
      };
      if (routingnumber) {
        bank_account.routing_number = routingnumber;
      }
      if (account_type) {
        bank_account.account_type = account_type;
      }
      const token = await stripe.tokens.create({
        bank_account: bank_account,
      });
      await stripe.accounts.createExternalAccount(account.id, {
        external_account: token.id,
      });
    } else {
      await stripe.accounts.createExternalAccount(account.id, {
        external_account: cardToken,
      });
    }

    // Retrieve the balance
    const balance = await stripe.balance.retrieve({
      stripeAccount: account.id,
    });

    // Respond with account and balance details
    res.send({ account, balance });
  } catch (err) {
    console.log(err);
    return res.status(400).json({
      status: 400,
      message: err.message,
    });
  }
});

app.post("/createCardForStripeAccountRedirect", auth, async (req, res) => {
  try {
    let { accountId } = req.body;
    // Retrieve the Stripe account information
    const account = await stripe.accounts.retrieve(accountId);
    const status = account.individual?.verification?.status;
    const balance = await stripe.balance.retrieve({
      stripeAccount: accountId,
    });

    res.send({ status, account, balance });
  } catch (err) {
    res.send({ err });
  }
});

// app.post("/createCardForStripeAccountRedirect", async (req, res) => {
//   try {
//     const accountLink = await stripe.accountLinks.create({
//       account: req.body.accountId,
//       refresh_url:
//         "https://www.voegol.com.br/es-ar/ofertas/argentina?gad_source=1&gclid=Cj0KCQiAw6yuBhDrARIsACf94RWLzu5R-NChpc9O46Z_tgYAJq9khiI9rhhfssfCeZ2Uo5tbBLgaplkaAs51EALw_wcB&gclsrc=aw.ds",
//       return_url:
//         "https://www.voegol.com.br/es-ar/ofertas/argentina?gad_source=1&gclid=Cj0KCQiAw6yuBhDrARIsACf94RWLzu5R-NChpc9O46Z_tgYAJq9khiI9rhhfssfCeZ2Uo5tbBLgaplkaAs51EALw_wcB&gclsrc=aw.ds",
//       type: "account_onboarding",
//       collect: "eventually_due",
//     });

//     res.send({ accountLink });
//   } catch (err) {
//     res.send({ err });
//   }
// });

app.post("/createtoken", auth, async (req, res) => {
  try {
    const token = await stripe.tokens.create({
      bank_account: {
        country: "EC",
        account_number: "000123456789", // Replace with actual account number
        routing_number: "AAAAECE1XXX", // Replace with actual routing number
        currency: "USD",
      },
    });
    res.send({ token: token });
  } catch (err) {
    res.send({ err });
  }
});

app.post("/create-payment-link", auth, async (req, res) => {
  try {
    let { accountId, amount, docId, seller_id } = req.body;
    const stripeAccountId = accountId;
    const totalAmount = parseInt(amount) * 100;
    const feeAmount = Math.round(totalAmount * 0.07);

    // Create a PaymentIntent with manual capture (hold money)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalAmount,
      currency: "usd",
      payment_method_types: ["card"],
      application_fee_amount: feeAmount,
      capture_method: "manual", // This will authorize but not capture funds
      transfer_data: {
        destination: stripeAccountId,
      },
      on_behalf_of: stripeAccountId,
      metadata: {
        visit_id: docId,
        seller_id: seller_id,
      },
    });

    res.send({ paymentIntent });
  } catch (err) {
    console.error("Error in server:", err);
    res.status(500).send({ error: err });
  }
});

app.post("/deleteacc", auth, async (req, res) => {
  try {
    let { accountId } = req.body;
    const deleted = await stripe.accounts.del(accountId);
    res.send({ deleted });
  } catch (err) {
    res.send({ err });
  }
});

app.post("/getaccount", async (req, res) => {
  try {
    let { accountId } = req.body;
    const account = await stripe.accounts.retrieve(accountId);
    const verification_status = account?.individual?.verification?.status;
    const transfer_status = account?.capabilities?.transfers;
    const meta_data = account?.metadata;
    res.send({ verification_status, transfer_status, meta_data, account });
  } catch (err) {
    res.send({ err });
  }
});

app.post("/updateaccount", auth, async (req, res) => {
  try {
    let { accountId, data } = req.body;
    const account = await stripe.accounts.update(accountId, data);
    res.send({ account });
  } catch (err) {
    res.send({ err });
    console.error(err);
  }
});

app.post("/externalaccount", auth, async (req, res) => {
  try {
    let { accountId } = req.body;
    const account = await stripe.accounts.retrieve(accountId);
    const externalAccount = await stripe.accounts.deleteExternalAccount(
      accountId,
      account.external_accounts.data[0].id
    );
    res.send({ externalAccount });
  } catch (err) {
    res.send({ err });
  }
});

app.post("/refund-charge-artist", auth, async (req, res) => {
  try {
    const { visitId, paymentId, userId } = req.body;
    const userDoc = await fstore.collection("users").doc(userId).get();

    if (!userDoc.exists) {
      console.log("User not found");
      return res.status(404).send({ error: "User not found" });
    }

    const userData = userDoc.data();
    const token = userData.fcmToken; // Ensure 'fcmToken' exists in the user's document

    const notificationData = {
      title: "Cancelled visit",
      description: `${userData.name} has cancelled your schedule visit`,
      date: new Date(),
      visitId: visitId,
      userId: userId,
      userImage: userData.image,
      isSeen: false,
    };

    const notificationRef = await fstore
      .collection("notifications")
      .add(notificationData);
    const notificationId = notificationRef.id;

    if (token) {
      const message = {
        notification: {
          title: "Cancelled visit",
          body: "Your Shedule Visit has been cancelled",
        },
        data: {
          url: userData.image,
          visitId: visitId,
          notificationId: notificationId,
        },
        token: token,
      };

      try {
        await admin.messaging().send(message);
        console.log("Notification sent successfully");
      } catch (err) {
        console.error("Error sending notification:", err);
      }
    } else {
      console.log("FCM token not found, notification saved to database");
    }

    await fstore.collection("visit").doc(visitId).update({
      status: false,
      visit_status: "cancelled",
    });

    // Retrieve the PaymentIntent
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentId);

    // If the payment is not captured, capture it first
    if (paymentIntent.status === "requires_capture") {
      await stripe.paymentIntents.capture(paymentId);
    }

    const refund = await stripe.refunds.create({
      payment_intent: paymentId,
      reason: "requested_by_customer",
      refund_application_fee: true,
      reverse_transfer: true,
    });

    res.send({ refund });
  } catch (err) {
    console.error("Error in server:", err);
    res.status(500).send({ error: err.message });
  }
});

app.post("/refund-charge-client", auth, async (req, res) => {
  try {
    const { visitId, paymentId, userId } = req.body;

    const userDoc = await fstore.collection("users").doc(userId).get();
    if (!userDoc.exists) {
      console.log("User not found");
      return res.status(404).send({ error: "User not found" });
    }

    const userData = userDoc.data();
    const token = userData.fcmToken;

    // Create notification for cancelled visit
    const notificationData = {
      title: "Cancelled visit",
      description: `${userData.name} has cancelled your scheduled visit`,
      date: new Date(),
      visitId: visitId,
      userId: userId,
      userImage: userData.image,
      isSeen: false,
    };

    const notificationRef = await fstore
      .collection("notifications")
      .add(notificationData);
    const notificationId = notificationRef.id;

    // Send notification via FCM if token exists
    if (token) {
      const message = {
        notification: {
          title: "Cancelled visit",
          body: "Your Scheduled Visit has been cancelled",
        },
        data: {
          url: userData.image,
          visitId: visitId,
          notificationId: notificationId,
        },
        token: token,
      };

      try {
        await admin.messaging().send(message);
        console.log("Notification sent successfully");
      } catch (err) {
        console.error("Error sending notification:", err);
      }
    } else {
      console.log("FCM token not found, notification saved to database");
    }

    await fstore.collection("visit").doc(visitId).update({
      status: false,
      visit_status: "cancelled",
    });

    // Retrieve the PaymentIntent
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentId);

    // If the payment is not captured, capture it first
    if (paymentIntent.status === "requires_capture") {
      await stripe.paymentIntents.capture(paymentId);
    }

    // After capturing, proceed to refund
    const refund = await stripe.refunds.create({
      payment_intent: paymentId,
      reason: "requested_by_customer",
      refund_application_fee: false, // Deduct application fee for client-side refunds
    });

    res.send({ refund });
  } catch (err) {
    console.error("Error in server:", err);
    res.status(500).send({ error: err.message });
  }
});

app.post("/payout", auth, async (req, res) => {
  try {
    const { seller_id, visitId } = req.body;

    const stripeinfo = await fstore
      .collection("stripe_data")
      .doc(seller_id)
      .get();
    const visitDoc = await fstore.collection("visit").doc(visitId).get();
    const paymentIntent = await stripe.paymentIntents.capture(
      visitDoc.data().paymentIntent
    );

    res.status(200).send({ message: "Success", status: 200, paymentIntent });
  } catch (err) {
    res.status(500).send({ error: err.message, status: 500 });
  }
});

const sendNotification = async (userId, visitId, title, body) => {
  try {
    // Fetch the user's document from the Firestore collection using userId
    const userDoc = await fstore.collection("users").doc(userId).get();

    if (!userDoc.exists) {
      console.log("User not found");
      return false;
    }

    // Extract the user's FCM token from the document
    const userData = userDoc.data();
    const token = userData.fcmToken; // Ensure 'fcmToken' exists in the user's document
    const notificationData = {
      title: "Visit",
      description: `${userData.name} has Send a shedule visit`,
      date: new Date(),
      visitId: visitId,
      userId: userId,
      userImage: userData.image,
      isSeen: false,
    };

    const notificationRef = await fstore
      .collection("notifications")
      .add(notificationData);
    const notificationId = notificationRef.id;

    if (!token) {
      console.log("FCM token not found");
      return false;
    }

    // Prepare the message
    const message = {
      notification: {
        title: title,
        body: body,
      },
      data: {
        url: userData.image,
        visitId: visitId,
        notificationId: notificationId,
      },
      token: token,
    };

    await admin.messaging().send(message);

    return true;
  } catch (error) {
    console.error("Error sending notification:", error.message);
    return false;
  }
};

const endpointSecret = `${process.env.STRIPE_WEBHOOK_SECRET}`;

app.post(
  "/webhook",
  bodyParser.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];

    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      console.error("Error message: " + err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // // Payment Intent Succeeded
    // if (event.type === "payment_intent.succeeded") {
    //   try {
    //     const visitId = event.data.object?.metadata?.visit_id; // Ensure metadata contains visit_id
    //     if (!visitId) {
    //       console.log("visit_id not found in metadata");
    //       return res.status(400).send("visit_id not found in metadata");
    //     }

    //     await fstore.collection("visit").doc(visitId).update({
    //       status: true,
    //       visit_status: "inprogress",
    //       paymentIntent: event.data.object.id,
    //     });

    //     const notificationSent = await sendNotification(
    //       event.data.object?.metadata?.seller_id,
    //       visitId,
    //       "Offer",
    //       "You Got A New Notification"
    //     );

    //     if (!notificationSent) {
    //       console.log("Failed to send notification");
    //     }
    //   } catch (error) {
    //     console.error("Error handling webhook event:", error.message);
    //     return res.status(500).send("Internal Server Error");
    //   }
    // }

    if (event.type === "account.updated") {
      const account = event.data.object;
      const userId = event.data.object?.metadata?.user_id;

      // Extract the updated values
      const verificationStatus = account?.individual?.verification?.status;
      const transferStatus = account?.capabilities?.transfers;
      if (verificationStatus === "verified" && transferStatus == "active") {
        await fstore.collection("users").doc(userId).update({
          accountstatus: "verified",
        });
        await fstore.collection("stripe_data").doc(userId).update({
          transfermoney: transferStatus,
          verificationStatus: verificationStatus,
        });
      }
    }

    if (event.type == "payment_intent.amount_capturable_updated") {
      try {
        const visitId = event.data.object?.metadata?.visit_id; // Ensure metadata contains visit_id
        if (!visitId) {
          console.log("visit_id not found in metadata");
          return res.status(400).send("visit_id not found in metadata");
        }

        await fstore.collection("visit").doc(visitId).update({
          status: true,
          visit_status: "inprogress",
          paymentIntent: event.data.object.id,
        });

        const notificationSent = await sendNotification(
          event.data.object?.metadata?.seller_id,
          visitId,
          "Offer",
          "You Got A New Notification"
        );

        if (!notificationSent) {
          console.log("Failed to send notification");
        }
      } catch (error) {
        console.error("Error handling webhook event:", error.message);
        return res.status(500).send("Internal Server Error");
      }
    }

    return res.status(200).json({
      status: 200,
      message: "Success",
    });
  }
);

app.post("/test", async (req, res) => {
  try {
    // Fetch the user's document from the Firestore collection using userId
    const { userId, visitId } = req.body;
    const userDoc = await fstore.collection("users").doc(userId).get();

    if (!userDoc.exists) {
      console.log("User not found");
      return false;
    }

    // Extract the user's FCM token from the document
    const userData = userDoc.data();
    const token = userData.fcmToken; // Ensure 'fcmToken' exists in the user's document

    if (!token) {
      console.log("FCM token not found");
      return false;
    }

    const notificationData = {
      title: "Visit",
      description: `${userData.name} has Send a shedule visit`,
      date: new Date(),
      visitId: visitId,
      userId: userId,
      userImage: userData.image,
      isSeen: false,
    };

    const notificationRef = await fstore
      .collection("notifications")
      .add(notificationData);
    const notificationId = notificationRef.id;
    // Prepare the message
    const message = {
      notification: {
        title: "Test",
        body: "test notification",
      },
      data: {
        url: userData.image,
        visitId: visitId,
        notificationId: notificationId,
      },
      token: token,
    };

    await admin.messaging().send(message);
    return res.status(200).json({
      status: 200,
      message: "Success",
      description: "Story created successfully",
    });
  } catch (error) {
    console.error("Error sending notification:", error.message);
    return res.status(200).json({
      status: 200,
      message: "Success",
      description: "Story created successfully",
    });
  }
});

app.post("/get-balance", auth, async (req, res) => {
  try {
    const { seller_id } = req.body;
    const stripeinfo = await fstore
      .collection("stripe_data")
      .doc(seller_id)
      .get();
    // Get the Stripe balance for the connected account
    const balance = await stripe.balance.retrieve({
      stripeAccount: stripeinfo.data().stripe_id,
    });
    const availableBalance = balance.available[0].amount;
    res
      .status(200)
      .json({ availableBalance, balanceFullavailable: balance.available });
  } catch (error) {
    console.error("Error retrieving balance:", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

app.post("/withdraw", auth, async (req, res) => {
  try {
    const { seller_id, amount } = req.body;
    const stripeinfo = await fstore
      .collection("stripe_data")
      .doc(seller_id)
      .get();
    const balance = await stripe.balance.retrieve({
      stripeAccount: stripeinfo.data().stripe_id,
    });

    const availableBalance = balance.available[0].amount;
    const requiredAmount = amount * 100;

    if (availableBalance < requiredAmount) {
      return res.status(400).send({
        message: "Insufficient funds in the Stripe account for this payout.",
        status: 400,
      });
    }

    // Create a manual payout if balance is sufficient
    const payout = await stripe.payouts.create(
      {
        amount: requiredAmount,
        currency: balance.available[0].currency,
      },
      {
        stripeAccount: stripeinfo.data().stripe_id,
      }
    );
    console.log("Payout created:", payout);
    res.status(200).json({ message: "Payout Created", payout, status: 200 });
  } catch (error) {
    console.error("Error withdrawing money:", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
});
