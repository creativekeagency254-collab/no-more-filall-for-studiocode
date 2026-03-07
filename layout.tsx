// app/layout.tsx
// Studio Code — Next.js Root Layout with full SEO metadata
// Place this at: /app/layout.tsx (App Router) or wrap _app.tsx (Pages Router)

import type { Metadata, Viewport } from 'next'

const BASE_URL = 'https://www.studiocode.co.ke'

// ─────────────────────────────────────────────────────
//  METADATA — exported and picked up by Next.js automatically
//  Covers: basic SEO, Open Graph, Twitter Card, robots,
//  canonical URL, keywords, and app icons
// ─────────────────────────────────────────────────────
export const metadata: Metadata = {
  // ── Core ──────────────────────────────────────────
  metadataBase: new URL(BASE_URL),
  title: {
    default: 'Studio Code — Kenya & East Africa Web & App Developers',
    template: '%s | Studio Code',
  },
  description:
    'Verified developers. Transparent KSh pricing. Milestone-based escrow payments. ' +
    'We build websites, mobile apps, M-Pesa integrations, API systems, dashboards, ' +
    'and CRM platforms for businesses in Kenya and East Africa. 110% refund guarantee.',

  // ── Keywords ──────────────────────────────────────
  keywords: [
    'web developers Kenya',
    'app developers Nairobi',
    'M-Pesa integration Kenya',
    'website design Kenya',
    'mobile app development East Africa',
    'API development Kenya',
    'CRM development Nairobi',
    'software developers Kenya',
    'escrow payments developers',
    'Studio Code Kenya',
    'web development East Africa',
    'dashboard development Kenya',
    'freelance developers Kenya',
  ],

  // ── Authors & Publisher ───────────────────────────
  authors: [{ name: 'Studio Code', url: BASE_URL }],
  creator: 'Studio Code',
  publisher: 'Studio Code',

  // ── Canonical ─────────────────────────────────────
  alternates: {
    canonical: BASE_URL,
  },

  // ── Robots ────────────────────────────────────────
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },

  // ── Open Graph (Facebook, LinkedIn, WhatsApp) ─────
  openGraph: {
    type: 'website',
    locale: 'en_KE',
    url: BASE_URL,
    siteName: 'Studio Code',
    title: 'Studio Code — Kenya & East Africa Web & App Developers',
    description:
      'Verified developers. Transparent KSh pricing. Milestone-based escrow payments. ' +
      'Websites, mobile apps, M-Pesa integrations, and more. 110% refund guarantee.',
    images: [
      {
        url: `${BASE_URL}/og-image.png`,  // 1200×630px — create this image
        width: 1200,
        height: 630,
        alt: 'Studio Code — Kenya & East Africa Web & App Developers',
      },
    ],
  },

  // ── Twitter / X Card ──────────────────────────────
  twitter: {
    card: 'summary_large_image',
    title: 'Studio Code — Kenya & East Africa Web & App Developers',
    description:
      'Verified developers. Transparent KSh pricing. Milestone-based escrow. ' +
      '110% refund guarantee.',
    images: [`${BASE_URL}/og-image.png`],
    creator: '@studiocode_ke',   // update to your real handle
    site: '@studiocode_ke',
  },

  // ── App Icons ─────────────────────────────────────
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/icon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/icon-32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
    other: [
      { rel: 'mask-icon', url: '/safari-pinned-tab.svg', color: '#7DC870' },
    ],
  },

  // ── Manifest (PWA) ────────────────────────────────
  manifest: `${BASE_URL}/site.webmanifest`,

  // ── Verification (add your codes from Search Console) ──
  verification: {
    google: 'PASTE_YOUR_GOOGLE_SEARCH_CONSOLE_CODE_HERE',
    // yandex: 'your-yandex-code',
    // bing: 'your-bing-code',
  },
}

// ─────────────────────────────────────────────────────
//  VIEWPORT — separate export (Next.js 14+ requirement)
// ─────────────────────────────────────────────────────
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)',  color: '#0F0F0F' },
    { media: '(prefers-color-scheme: light)', color: '#f5f5f5' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
}

// ─────────────────────────────────────────────────────
//  ROOT LAYOUT
// ─────────────────────────────────────────────────────
export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        {/*
          Next.js injects all metadata automatically from the export above.
          Only add things here that Next.js cannot handle natively.
        */}

        {/* JSON-LD Structured Data — helps Google understand the business */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'ProfessionalService',
              name: 'Studio Code',
              url: BASE_URL,
              logo: `${BASE_URL}/icon-512.png`,
              description:
                'Kenya and East Africa web and app development agency. ' +
                'Verified developers, milestone-based escrow payments, ' +
                'M-Pesa integration, KSh transparent pricing.',
              areaServed: [
                { '@type': 'Country', name: 'Kenya' },
                { '@type': 'Country', name: 'Uganda' },
                { '@type': 'Country', name: 'Tanzania' },
              ],
              address: {
                '@type': 'PostalAddress',
                addressLocality: 'Nairobi',
                addressCountry: 'KE',
              },
              contactPoint: {
                '@type': 'ContactPoint',
                contactType: 'customer support',
                areaServed: 'KE',
                availableLanguage: ['English', 'Swahili'],
              },
              sameAs: [
                'https://twitter.com/studiocode_ke',   // update
                'https://linkedin.com/company/studiocode-ke', // update
              ],
              priceRange: 'KSh',
              currenciesAccepted: 'KES',
              paymentAccepted: 'M-Pesa, Credit Card, Bank Transfer',
            }),
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  )
}


// ─────────────────────────────────────────────────────
//  NOTES — what to do next
// ─────────────────────────────────────────────────────
/*
  1. CREATE /public/og-image.png (1200×630px)
     — Screenshot or design of your hero / dashboard mockup
     — Used by Facebook, LinkedIn, WhatsApp previews

  2. CREATE /public/favicon.ico and icon PNGs
     — Use https://realfavicongenerator.net to generate the full set

  3. REPLACE verification codes
     — Go to Google Search Console → Add property → HTML tag method
     — Paste the code value into metadata.verification.google above

  4. ADD /public/robots.txt  (provided separately)
  5. ADD /public/sitemap.xml (provided separately)

  6. For dynamic pages (e.g. /blog/[slug]) use generateMetadata():

     export async function generateMetadata({ params }): Promise<Metadata> {
       const post = await getPost(params.slug)
       return {
         title: post.title,
         description: post.excerpt,
         openGraph: { images: [post.coverImage] },
       }
     }
*/
