/**
 * Daily digest email — "today's post is ready to review".
 * Rendered to HTML at send time (React Email). Contains a preview + a deep
 * link only; NEVER any tokens or secrets.
 */
import * as React from "react";
import {
  Html,
  Head,
  Preview,
  Body,
  Container,
  Heading,
  Text,
  Img,
  Button,
  Section,
  Hr,
} from "@react-email/components";

export interface DailyDigestProps {
  name?: string | null;
  hook: string;
  snippet: string;
  imageThumbUrl?: string | null;
  reviewUrl: string;
}

export function DailyDigest({
  name,
  hook,
  snippet,
  imageThumbUrl,
  reviewUrl,
}: DailyDigestProps) {
  return (
    <Html>
      <Head />
      <Preview>Your LinkedIn post for today is ready to review</Preview>
      <Body style={{ backgroundColor: "#f3f2ef", fontFamily: "Arial, sans-serif" }}>
        <Container style={{ backgroundColor: "#ffffff", padding: "24px", borderRadius: 8 }}>
          <Heading style={{ color: "#0a66c2", fontSize: 20 }}>
            ✅ Today&apos;s post is ready
          </Heading>
          <Text>Hi {name ?? "there"}, here&apos;s a preview of today&apos;s draft.</Text>

          {imageThumbUrl ? (
            <Img
              src={imageThumbUrl}
              width="552"
              alt="Generated post image"
              style={{ borderRadius: 6, margin: "12px 0" }}
            />
          ) : null}

          <Section style={{ backgroundColor: "#f3f6f8", padding: 16, borderRadius: 6 }}>
            <Text style={{ fontWeight: "bold", margin: 0 }}>{hook}</Text>
            <Text style={{ margin: "8px 0 0", color: "#444" }}>{snippet}</Text>
          </Section>

          <Button
            href={reviewUrl}
            style={{
              backgroundColor: "#0a66c2",
              color: "#ffffff",
              padding: "12px 20px",
              borderRadius: 24,
              textDecoration: "none",
              display: "inline-block",
              marginTop: 20,
              fontWeight: "bold",
            }}
          >
            Review &amp; Publish
          </Button>

          <Hr style={{ margin: "24px 0", borderColor: "#e0e0e0" }} />
          <Text style={{ fontSize: 12, color: "#888" }}>
            Nothing is posted to LinkedIn until you review and click Publish yourself.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export default DailyDigest;
