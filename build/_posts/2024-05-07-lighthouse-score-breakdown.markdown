---
layout: post
title: "🚀 Achieving 100/100 Lighthouse Metrics: A Technical Breakdown"
date: 2024-05-07 13:32:20 +0300
description: 
    Ornaz.com - Explore the Technical Breakdown of Achieving 100/100 Lighthouse Metrics. 
    Discover how we optimize online shopping experiences with lightning-fast performance and superior SEO solutions. 🚀💪 # Add post description (optional)
tags: [ ornaz, EcommerceRevolution, WebsitePerformance]
img: ornaz-lighthouse-breakdown/diagram.png
---
In my [previous post](https://ashutoshverma.com/ornaz-desktop-lighthouse-metrices/) I shared how we achieved almost all **100/100 Lighthouse metrics**. Here’s a breakdown of how we did it:

### **Backend Servers**:

**Nginx as API Gateway (entry point):**
- Used as a load balancer and routed as per requirement.
- **Protip:** Avoid regex concatenation to prevent slowing down routing.
- Utilized Gzip compression for improved performance (Remember, it comes with a cost).
- Dropped SSL at API gateway to increase performance.
- Utilized the socket method for proxy_pass or routing to avoid direct connection to localhost: port.
- Configured nginx for request pooling at **100 req/sec**.
- Added rate limiting at **50 req/sec** per IP.

**Django Server:**
- Acted as a single source of truth for most services.
- Used Gunicorn with Django, configured with **3 workers**.
- Utilized **2 master and 3 slave database servers** for optimized results.
- Implemented Redis-server for caching commonly used data.
- Used template caching for SSR pages.
- Achieved an API response time of **50-100 ms** under normal traffic.
- Added API rate limiter as per the use case.

**Celery Worker:**
- Used for all cron tasks, long-running tasks, emails/SMS, etc. to avoid blocking user responses.
- Improved API responses by **80-90%**.
- Enabled the main server to focus more on serving user requests.

**Cache-Server (ExpressJs):**
- Implemented **cache.ornaz.com** (express-based server) to reduce the load on the main server.
- Reduced main server load by **70%**.
- Decreased API response time to **30-60 ms**.
- Utilized pm2 for management and multiple threads to serve requests.
- Used a shared global in-memory cache to serve content, ensuring website functionality even if the main server is down.
- Served inventory APIs and SEO APIs to get SEO details along with JSON-LD data.

**Logging Server (Express-based service):**
- Reduced server load on the main server by adding a microservice for logging **logging.ornaz.com** .
- Triggered all campaign events for further processing.
- Used for running marketing campaigns, user journey flow, and conversion funnels.

**Monitoring Server:**
- Utilized Prometheus and Grafana to monitor all nodes' detailed metrics in real-time.
- Used Sentry to monitor errors.

**Campaign Service:**
- Utilized a third-party service for creating campaigns (sending WhatsApp messages, emails, push notifications) based on user journey/conversion flows.


### **Frontend Servers**:

**React-Native (Mobile):**
- Utilized for mobile-web, Android app, and iOS app.
- Utilized React-Native web to create a static JS client-side server, served from CDN.
- Used CDN for fast serving (**28 ms** response time).
- Utilized service workers to cache everything that is not user-specific, ensuring offline functionality.
- Cached APIs at the service-worker level, further reducing server load.

**Next.js Server (Desktop):**
- Utilized for desktop-web and SEO purposes.
- Leveraged Next.js (SSG + ISR + CSR) for SEO-specific websites.
- Focused on SEO-friendly HTML and followed Google's recommendations for SEO.

**Django server (Fallback):**
- Used as a fallback to serve pages exploiting the MVT Framework.
- Served campaign-based pages that were changed daily, ensuring a seamless user experience.

### **Frontend Optimization:**
- Used code splitting and lazy load whenever possible in an effective manner.
- Served static content from CDN with caching for more than **2 weeks**.
- Utilized service worker to cache APIs.
- Preloaded main-banner assets.
- Pre-connected domains.
- Minimized the number of domains and APIs hit, combining APIs when possible, and avoiding request chaining.
- Used async/await efficiently, with careful consideration.
- Split CSS and JS modules as per loading order.
- Converted images into webP (Avif can also be used) and served them from CDN.
- Used srcsets with thumbnails for images > **300px** render size.
- Maintained a **1:1.5 ratio** for intrinsic size: render size.
- Utilized well-maintained schema/state/store for hydration.
- Always preferred HTML5 SEO-friendly elements.
- Avoided extra DOM elements.
- Stayed aware of content layout shifts.
- Meta tags were crucial for SEO, refer to **ornaz.com** for best practices.
- **Protip:** Used Lighthouse to check for errors and fixed them.

Stay tuned for more insights on how we optimized SEO and much more!

## ** Basic Overview of Architecture **

![](https://s3.ap-south-1.amazonaws.com/ashutoshverma.com/uploaded_assets/lighthouse-breakdown/79ead05f-3_iagram.png)

