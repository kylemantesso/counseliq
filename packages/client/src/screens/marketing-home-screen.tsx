"use client";

import { useState, type ReactNode } from "react";
import { Link, TextLink } from "solito/link";
import {
  Box,
  Button,
  ButtonText,
  Heading,
  Input,
  InputField,
  Pressable,
  ScrollView,
  Text,
} from "@counseliq/ui";
import { footerLinkStyle } from "../auth/auth-styles";
import { GITHUB_REPO_URL, ONBOARDING_SLIDES } from "../constants";

const PAGE_BG = "bg-[#f5f5f0]";
const BORDER = "border-[#ddd8d0]";
const MUTED = "text-[#888888]";
const INK = "text-[#1a1a1a]";

const FEATURES = [
  {
    title: "Feature one",
    desc: "Describe the first key feature of your product and the problem it solves for users.",
  },
  {
    title: "Feature two",
    desc: "Describe the second key feature and why it matters to your target audience.",
  },
  {
    title: "Feature three",
    desc: "Describe the third key feature and how it differentiates you from alternatives.",
  },
  {
    title: "Feature four",
    desc: "Describe another feature that adds value and keeps users coming back.",
  },
  {
    title: "Feature five",
    desc: "Describe a feature related to trust, security, or reliability that users care about.",
  },
  {
    title: "Feature six",
    desc: "Describe a final feature that rounds out your product offering.",
  },
];

const PLANS = [
  {
    name: "Starter",
    price: "$0",
    label: "Forever free",
    features: ["Core features", "Up to 3 projects", "Community support"],
    featured: false,
  },
  {
    name: "Pro",
    price: "$12",
    label: "Per user / month",
    features: [
      "Unlimited projects",
      "Advanced features",
      "Integrations",
      "Priority support",
    ],
    featured: true,
  },
  {
    name: "Teams",
    price: "$49",
    label: "Per team / month",
    features: [
      "Everything in Pro",
      "Admin dashboard",
      "Team management",
      "Dedicated support",
    ],
    featured: false,
  },
];

const FOOTER_LINKS = {
  Product: ["Features", "Pricing", "Dashboard"],
  Company: ["About", "Blog", "Contact"],
  Legal: ["Privacy", "Terms"],
};

function BrandMark() {
  return (
    <Box className="flex-row items-center gap-2">
      <Box className="h-8 w-8 items-center justify-center rounded-full bg-[#2d2d2d]">
        <Text className="block text-sm font-bold text-white">Y</Text>
      </Box>
      <Text className={`block text-lg font-bold ${INK}`}>YourApp</Text>
    </Box>
  );
}

function NavLink({ children }: { children: ReactNode }) {
  return (
    <Text className={`block text-[15px] font-medium ${MUTED}`}>{children}</Text>
  );
}

function PillButton({
  children,
  variant = "solid",
  className = "",
}: {
  children: ReactNode;
  variant?: "solid" | "outline" | "inverse";
  className?: string;
}) {
  const solid = variant === "solid";
  const inverse = variant === "inverse";
  return (
    <Button
      variant={solid || inverse ? "default" : "outline"}
      size="lg"
      className={`rounded-full px-6 ${
        inverse
          ? "border-white bg-white"
          : solid
            ? "border-[#2d2d2d] bg-[#2d2d2d]"
            : `border-[#ddd8d0] bg-white`
      } ${className}`}
    >
      <ButtonText
        className={`font-semibold ${
          inverse ? INK : solid ? "text-white" : INK
        }`}
      >
        {children}
      </ButtonText>
    </Button>
  );
}

function LinkButton({
  href,
  children,
  variant = "solid",
  fullWidth = false,
}: {
  href: string;
  children: ReactNode;
  variant?: "solid" | "outline" | "inverse";
  fullWidth?: boolean;
}) {
  return (
    <Link href={href}>
      <Box className={fullWidth ? "w-full" : "inline-flex self-start"}>
        <PillButton variant={variant} className={fullWidth ? "w-full" : ""}>
          {children}
        </PillButton>
      </Box>
    </Link>
  );
}

function SectionEyebrow({ children }: { children: ReactNode }) {
  return (
    <Text
      className={`mb-3 block text-xs font-medium uppercase tracking-[0.15em] ${MUTED}`}
    >
      {children}
    </Text>
  );
}

export function MarketingHomeScreen() {
  const [activeSlide, setActiveSlide] = useState(0);
  const [email, setEmail] = useState("");
  const [subscribed, setSubscribed] = useState(false);

  const handleSubscribe = () => {
    if (email.trim()) setSubscribed(true);
  };

  return (
    <ScrollView className={`min-h-full flex-1 flex-col ${PAGE_BG}`}>
      {/* Header */}
      <Box className={`flex-col border-b ${BORDER} ${PAGE_BG}`}>
        <Box className="mx-auto w-full max-w-[1120px] flex-row flex-wrap items-center justify-between gap-3 px-6 py-3.5">
          <BrandMark />
          <Box className="flex-row flex-wrap items-center gap-5">
            <NavLink>Features</NavLink>
            <NavLink>Pricing</NavLink>
            <TextLink href="/ui">
              <NavLink>Components</NavLink>
            </TextLink>
            <TextLink href="/login">
              <NavLink>Log In</NavLink>
            </TextLink>
            <LinkButton href="/signup" variant="solid">
              Get Started
            </LinkButton>
          </Box>
        </Box>
      </Box>

      {/* Hero */}
      <Box className="mx-auto w-full max-w-[1120px] flex-col px-6 py-12">
        <Box className="flex-row flex-wrap items-center gap-8">
          <Box className="min-w-[280px] flex-1 flex-col">
            <SectionEyebrow>Swipe to discover more</SectionEyebrow>
            <Heading
              size="4xl"
              className={`mb-4 block text-[42px] font-bold leading-[48px] tracking-tight ${INK}`}
            >
              Built for what matters to you.
            </Heading>
            <Text className={`mb-6 block max-w-[520px] text-[17px] leading-[26px] ${MUTED}`}>
              Sign up to get started with your journey. Discover something new,
              track your progress, and see results from day one.
            </Text>
            <Box className="mb-5 flex-row flex-wrap items-center gap-3">
              <LinkButton href="/signup">Get Started</LinkButton>
              <PillButton variant="outline">Learn more</PillButton>
            </Box>
            <Box className="flex-row flex-wrap gap-4">
              <Text className={`block text-sm ${MUTED}`}>
                <Text className={`font-bold ${INK}`}>4.9/5</Text> average rating
              </Text>
              <Text className={`block text-sm ${MUTED}`}>
                <Text className={`font-bold ${INK}`}>10K+</Text> active users
              </Text>
              <Text className={`block text-sm ${MUTED}`}>
                <Text className={`font-bold ${INK}`}>99%</Text> uptime
              </Text>
            </Box>
          </Box>

          <Box
            className={`min-w-[280px] max-w-[360px] flex-1 flex-col self-center rounded-3xl border ${BORDER} bg-white p-6`}
          >
            <Box className="relative mb-5 h-[100px] w-[100px] items-center justify-center rounded-full bg-[#eae8e3]">
              <Text className="block text-[40px] text-[#aaa69e]">
                {ONBOARDING_SLIDES[activeSlide].icon}
              </Text>
              <Box
                className={`absolute bottom-0 right-[-6px] h-8 w-8 items-center justify-center rounded-full border ${BORDER} bg-white`}
              >
                <Text className="block text-xs">
                  {ONBOARDING_SLIDES[activeSlide].badge}
                </Text>
              </Box>
            </Box>
            <Heading
              size="2xl"
              className={`mb-4 block text-[26px] font-bold leading-[30px] ${INK}`}
            >
              {ONBOARDING_SLIDES[activeSlide].title}
            </Heading>
            <Box className="mb-4 flex-row items-center gap-1.5">
              {ONBOARDING_SLIDES.map((_, i) => (
                <Pressable key={i} onPress={() => setActiveSlide(i)}>
                  <Box
                    className={`h-2 w-2 rounded-full ${
                      i === activeSlide ? "bg-[#1a1a1a]" : "bg-[#d4d4d0]"
                    }`}
                  />
                </Pressable>
              ))}
            </Box>
            <LinkButton href="/signup" fullWidth>
              Get Started
            </LinkButton>
            <Text className={`mt-2.5 block text-center text-[13px] ${MUTED}`}>
              Already have an account?{" "}
              <TextLink href="/login" style={footerLinkStyle}>
                Log In
              </TextLink>
            </Text>
          </Box>
        </Box>
      </Box>

      {/* Features */}
      <Box className="mx-auto w-full max-w-[1120px] flex-col px-6 py-12">
        <SectionEyebrow>Why YourApp</SectionEyebrow>
        <Heading
          size="3xl"
          className={`mb-8 block text-[32px] font-bold tracking-tight ${INK}`}
        >
          Everything you need in one place.
        </Heading>
        <Box className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {FEATURES.map((feature) => (
            <Box
              key={feature.title}
              className={`flex-col rounded-2xl border ${BORDER} bg-white p-5`}
            >
              <Text className={`mb-2 block text-lg font-semibold ${INK}`}>
                {feature.title}
              </Text>
              <Text className={`block leading-[22px] ${MUTED}`}>{feature.desc}</Text>
            </Box>
          ))}
        </Box>
      </Box>

      {/* Pricing */}
      <Box className={`flex-col border-y ${BORDER} bg-[#fafaf6]`}>
        <Box className="mx-auto w-full max-w-[1120px] flex-col px-6 py-12">
          <SectionEyebrow>Pricing</SectionEyebrow>
          <Heading
            size="3xl"
            className={`mb-8 block text-[32px] font-bold tracking-tight ${INK}`}
          >
            Simple, transparent pricing.
          </Heading>
          <Box className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {PLANS.map((plan) => (
              <Box
                key={plan.name}
                className={`flex-col rounded-2xl border p-[22px] ${
                  plan.featured
                    ? "border-[#1a1a1a] bg-[#1a1a1a]"
                    : `${BORDER} bg-white`
                }`}
              >
                {plan.featured ? (
                  <Text className="mb-3 block self-start rounded-full border border-white/25 bg-white/15 px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-white">
                    Most popular
                  </Text>
                ) : null}
                <Text
                  className={`block text-xl font-semibold ${
                    plan.featured ? "text-white" : INK
                  }`}
                >
                  {plan.name}
                </Text>
                <Text
                  className={`mt-2 block text-[34px] font-extrabold ${
                    plan.featured ? "text-white" : INK
                  }`}
                >
                  {plan.price}
                </Text>
                <Text
                  className={`mb-3 block text-sm ${
                    plan.featured ? "text-[#d4d4d0]" : MUTED
                  }`}
                >
                  {plan.label}
                </Text>
                {plan.features.map((feature) => (
                  <Text
                    key={feature}
                    className={`mb-2 block text-sm ${
                      plan.featured ? "text-[#d4d4d0]" : MUTED
                    }`}
                  >
                    <Text className="text-[#2d8a6e]">✓ </Text>
                    {feature}
                  </Text>
                ))}
                <Box className="mt-4">
                  <LinkButton
                    href="/signup"
                    variant={plan.featured ? "inverse" : "solid"}
                    fullWidth
                  >
                    Get Started
                  </LinkButton>
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>

      {/* CTA */}
      <Box className="mx-auto w-full max-w-[1120px] flex-col px-6 py-12">
        <Box className={`flex-col rounded-[20px] border ${BORDER} bg-[#eae8e3] p-8`}>
          <SectionEyebrow>Ready to get started?</SectionEyebrow>
          <Heading
            size="2xl"
            className={`mb-2 block text-[28px] font-bold tracking-tight ${INK}`}
          >
            Sign up to get started with your journey.
          </Heading>
          <Text className={`mb-5 block ${MUTED}`}>
            No credit card required. Cancel anytime.
          </Text>
          {subscribed ? (
            <Text className="block font-medium text-success">
              Thanks! You are on the list.
            </Text>
          ) : (
            <Box className="flex-row flex-wrap items-center gap-2.5">
              <Box className="min-w-[220px] flex-1">
                <Input
                  className={`h-11 min-h-11 rounded-full border-[#ddd8d0] bg-white`}
                >
                  <InputField
                    value={email}
                    onChangeText={setEmail}
                    placeholder="you@example.com"
                    placeholderTextColor="#888888"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    className={`px-4 text-base ${INK}`}
                  />
                </Input>
              </Box>
              <Button
                variant="default"
                size="lg"
                onPress={handleSubscribe}
                className="self-start rounded-full border-[#2d2d2d] bg-[#2d2d2d] px-6"
              >
                <ButtonText className="font-semibold text-white">
                  Get Started
                </ButtonText>
              </Button>
            </Box>
          )}
        </Box>
      </Box>

      {/* Footer */}
      <Box className={`flex-col border-t ${BORDER} bg-[#fafaf6] px-6 py-10`}>
        <Box className="mx-auto w-full max-w-[1120px] flex-col gap-8">
          <Box className="flex-row flex-wrap justify-between gap-8">
            <Box className="min-w-[200px] flex-col gap-2">
              <BrandMark />
              <Text className={`block text-[15px] ${MUTED}`}>
                Built for what matters to you.
              </Text>
              <TextLink href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">
                <Text className={`block text-sm font-medium ${INK}`}>GitHub</Text>
              </TextLink>
            </Box>
            {Object.entries(FOOTER_LINKS).map(([title, links]) => (
              <Box key={title} className="min-w-[120px] flex-col gap-2">
                <Text className={`block text-sm font-semibold ${INK}`}>
                  {title}
                </Text>
                {links.map((link) => (
                  <Text key={link} className={`block text-sm ${MUTED}`}>
                    {link}
                  </Text>
                ))}
              </Box>
            ))}
          </Box>
          <Text className={`block text-sm ${MUTED}`}>
            © {new Date().getFullYear()} YourApp. All rights reserved.
          </Text>
        </Box>
      </Box>
    </ScrollView>
  );
}
