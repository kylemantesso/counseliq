"use client";

import { useRef, useState, useCallback } from "react";
import {
  Dimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
  ScrollView as RNScrollView,
} from "react-native";
import { TextLink } from "solito/link";
import { useRouter } from "solito/navigation";
import {
  Box,
  Button,
  ButtonText,
  ScrollView,
  Text,
} from "@counseliq/ui";
import { Screen } from "../components/screen";
import { footerLinkStyle } from "../auth/auth-styles";
import { ONBOARDING_SLIDES } from "../constants";

const { width } = Dimensions.get("window");
const CIRCLE_SIZE = Math.min(width * 0.44, 200);

export function OnboardingHomeScreen() {
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollRef = useRef<RNScrollView>(null);
  const router = useRouter();

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetX = e.nativeEvent.contentOffset.x;
      const index = Math.round(offsetX / width);
      setActiveIndex(index);
    },
    []
  );

  return (
    <Screen className="flex-1 bg-[#f5f5f0]" padding={{ top: 20, bottom: 20 }}>
      <Box className="flex-1">
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={handleScroll}
        >
          {ONBOARDING_SLIDES.map((slide, i) => (
            <Box
              key={i}
              style={{ width }}
              className="justify-center px-7 pt-5"
            >
              <Box
                style={{ width: CIRCLE_SIZE, height: CIRCLE_SIZE, borderRadius: CIRCLE_SIZE / 2 }}
                className="relative mb-6 items-center justify-center bg-[#e8e5df]"
              >
                <Text className="text-5xl text-[#aaa69e]">{slide.icon}</Text>
                <Box className="absolute -bottom-1 -right-1 h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm">
                  <Text className="text-base">{slide.badge}</Text>
                </Box>
              </Box>
              <Text className="text-[38px] font-bold leading-[44px] tracking-tight text-[#1a1a1a]">
                {slide.title}
              </Text>
            </Box>
          ))}
        </ScrollView>
      </Box>

      <Box className="items-center gap-3.5 py-6">
        <Text className="text-center text-[11px] font-semibold tracking-[2px] text-[#999999]">
          SWIPE TO DISCOVER MORE
        </Text>
        <Box className="flex-row items-center gap-2">
          {ONBOARDING_SLIDES.map((_, i) => (
            <Box
              key={i}
              className={`h-2 w-2 rounded-full ${
                i === activeIndex ? "bg-[#1a1a1a]" : "bg-[#d4d4d0]"
              }`}
            />
          ))}
        </Box>
      </Box>

      <Box className="gap-4 px-7">
        <Button
          variant="default"
          size="lg"
          onPress={() => router.push("/signup")}
          className="h-[54px] w-full self-stretch rounded-full border-[#2d2d2d] bg-[#2d2d2d]"
        >
          <ButtonText className="text-base font-semibold text-white">
            Get Started
          </ButtonText>
        </Button>

        <Text className="text-center text-sm text-[#888888]">
          Already have an account?{" "}
          <TextLink href="/login" style={footerLinkStyle}>
            Log In
          </TextLink>
        </Text>
      </Box>
    </Screen>
  );
}
