import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";
import { appWebOrigin } from "../emailResend";

const colors = {
  bg: "#F5F5F0",
  card: "#FFFFFF",
  fg: "#1A1A1A",
  fgDim: "#6B7280",
  accent: "#6366F1",
  border: "#E5E7EB",
};

type EmailLayoutProps = {
  preview: string;
  heading: string;
  children: ReactNode;
};

export function EmailLayout({ preview, heading, children }: EmailLayoutProps) {
  const adminUrl = `${appWebOrigin()}/admin`;
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: colors.bg, margin: 0, padding: "32px 16px" }}>
        <Container
          style={{
            backgroundColor: colors.card,
            border: `1px solid ${colors.border}`,
            borderRadius: 12,
            margin: "0 auto",
            maxWidth: "560px",
            padding: "32px 28px",
          }}
        >
          <Text
            style={{
              color: colors.accent,
              fontFamily:
                '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
              fontSize: "12px",
              fontWeight: 700,
              letterSpacing: "0.08em",
              margin: "0 0 20px",
              textTransform: "uppercase",
            }}
          >
            App Template
          </Text>
          <Heading
            style={{
              color: colors.fg,
              fontFamily:
                '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
              fontSize: "28px",
              fontWeight: 700,
              lineHeight: "1.2",
              margin: "0 0 20px",
            }}
          >
            {heading}
          </Heading>
          {children}
          <Hr style={{ borderColor: colors.border, margin: "28px 0 20px" }} />
          <Text
            style={{
              color: colors.fgDim,
              fontFamily:
                '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
              fontSize: "12px",
              lineHeight: "1.5",
              margin: 0,
            }}
          >
            App Template — cross-platform starter with Convex.
          </Text>
          <Text
            style={{
              color: colors.fgDim,
              fontFamily:
                '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
              fontSize: "12px",
              lineHeight: "1.5",
              margin: "12px 0 0",
            }}
          >
            <Link href={adminUrl} style={{ color: colors.accent }}>
              Open admin workspace
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export function EmailButton({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <Section style={{ margin: "28px 0 8px" }}>
      <Link
        href={href}
        style={{
          backgroundColor: colors.accent,
          color: "#FFFFFF",
          display: "inline-block",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          fontSize: "14px",
          fontWeight: 600,
          padding: "12px 20px",
          borderRadius: 8,
          textDecoration: "none",
        }}
      >
        {label}
      </Link>
    </Section>
  );
}

export function EmailParagraph({ children }: { children: ReactNode }) {
  return (
    <Text
      style={{
        color: colors.fgDim,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        fontSize: "15px",
        lineHeight: "1.6",
        margin: "0 0 16px",
      }}
    >
      {children}
    </Text>
  );
}
