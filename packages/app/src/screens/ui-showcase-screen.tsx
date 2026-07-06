"use client";

import { useState } from "react";
import { TextLink } from "solito/link";
import {
  Alert,
  AlertText,
  Box,
  Button,
  ButtonGroup,
  ButtonSpinner,
  ButtonText,
  CheckIcon,
  Divider,
  FormControl,
  FormControlError,
  FormControlErrorText,
  FormControlHelper,
  FormControlHelperText,
  FormControlLabel,
  FormControlLabelText,
  Heading,
  Input,
  InputField,
  Pressable,
  ScrollView,
  Spinner,
  Text,
  Toast,
  ToastDescription,
  ToastTitle,
  useToast,
} from "@app-template/ui";
import { Screen } from "../components/screen";

const BUTTON_VARIANTS = [
  "default",
  "destructive",
  "outline",
  "secondary",
  "ghost",
  "link",
] as const;

const BUTTON_SIZES = ["sm", "default", "lg"] as const;

const HEADING_SIZES = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl"] as const;

function ShowcaseSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Box className="flex-col gap-4 rounded-2xl border border-border bg-card p-6">
      <Box className="flex-col gap-1">
        <Heading size="lg">{title}</Heading>
        {description ? (
          <Text className="text-sm text-muted-foreground">{description}</Text>
        ) : null}
      </Box>
      {children}
    </Box>
  );
}

function Swatch({ name, className }: { name: string; className: string }) {
  return (
    <Box className="flex-col gap-2">
      <Box className={`h-12 w-full rounded-lg border border-border ${className}`} />
      <Text className="text-xs text-muted-foreground">{name}</Text>
    </Box>
  );
}

export function UiShowcaseScreen() {
  const toast = useToast();
  const [inputValue, setInputValue] = useState("");
  const [showInputError, setShowInputError] = useState(false);
  const [loading, setLoading] = useState(false);

  const showToast = (action: "success" | "error" | "muted") => {
    toast.show({
      placement: "top",
      render: ({ id }) => (
        <Toast nativeID={id} action={action}>
          <ToastTitle>
            {action === "success"
              ? "Success"
              : action === "error"
                ? "Error"
                : "Info"}
          </ToastTitle>
          <ToastDescription>
            Example {action} toast from the design system.
          </ToastDescription>
        </Toast>
      ),
    });
  };

  const handleLoadingDemo = () => {
    setLoading(true);
    setTimeout(() => setLoading(false), 1500);
  };

  return (
    <Screen className="flex-1 bg-background">
      <Box className="border-b border-border bg-card">
        <Box className="mx-auto w-full max-w-[1120px] flex-row flex-wrap items-center justify-between gap-3 px-6 py-4">
          <Box className="flex-col gap-1">
            <Heading size="xl">UI Kit</Heading>
            <Text className="text-sm text-muted-foreground">
              Gluestack v5 components exported from @app-template/ui
            </Text>
          </Box>
          <TextLink href="/">
            <Text className="text-sm font-semibold text-primary">← Back home</Text>
          </TextLink>
        </Box>
      </Box>

      <ScrollView className="w-full flex-1 flex-col items-center">
        <Box className="w-full max-w-[1120px] flex-col gap-8 p-6">
          <ShowcaseSection
            title="Colors"
            description="Semantic theme tokens from global.css"
          >
            <Box className="flex-row flex-wrap gap-4">
              <Box className="min-w-[120px] flex-1">
                <Swatch name="background" className="bg-background" />
              </Box>
              <Box className="min-w-[120px] flex-1">
                <Swatch name="foreground" className="bg-foreground" />
              </Box>
              <Box className="min-w-[120px] flex-1">
                <Swatch name="primary" className="bg-primary" />
              </Box>
              <Box className="min-w-[120px] flex-1">
                <Swatch name="secondary" className="bg-secondary" />
              </Box>
              <Box className="min-w-[120px] flex-1">
                <Swatch name="muted" className="bg-muted" />
              </Box>
              <Box className="min-w-[120px] flex-1">
                <Swatch name="accent" className="bg-accent" />
              </Box>
              <Box className="min-w-[120px] flex-1">
                <Swatch name="destructive" className="bg-destructive" />
              </Box>
              <Box className="min-w-[120px] flex-1">
                <Swatch name="success" className="bg-success" />
              </Box>
            </Box>
          </ShowcaseSection>

          <ShowcaseSection title="Typography">
            <Box className="flex-col gap-4">
              {HEADING_SIZES.map((size) => (
                <Heading key={size} size={size}>
                  Heading {size}
                </Heading>
              ))}
              <Divider />
              <Text className="text-base text-foreground">
                Body text — default foreground color
              </Text>
              <Text className="text-sm text-muted-foreground">
                Muted text — secondary copy and descriptions
              </Text>
              <Text className="text-sm font-semibold text-primary">
                Primary accent text — links and emphasis
              </Text>
            </Box>
          </ShowcaseSection>

          <ShowcaseSection title="Buttons" description="Variants and sizes">
            <Box className="flex-col gap-6">
              <Box className="flex-col gap-3">
                <Text className="text-sm font-medium text-foreground">Variants</Text>
                <Box className="flex-row flex-wrap gap-3">
                  {BUTTON_VARIANTS.map((variant) => (
                    <Button key={variant} variant={variant}>
                      <ButtonText className="capitalize">{variant}</ButtonText>
                    </Button>
                  ))}
                </Box>
              </Box>
              <Box className="flex-col gap-3">
                <Text className="text-sm font-medium text-foreground">Sizes</Text>
                <Box className="flex-row flex-wrap items-center gap-3">
                  {BUTTON_SIZES.map((size) => (
                    <Button key={size} size={size}>
                      <ButtonText className="capitalize">{size}</ButtonText>
                    </Button>
                  ))}
                </Box>
              </Box>
              <Box className="flex-col gap-3">
                <Text className="text-sm font-medium text-foreground">States</Text>
                <ButtonGroup className="flex-row flex-wrap gap-3">
                  <Button isDisabled>
                    <ButtonText>Disabled</ButtonText>
                  </Button>
                  <Button onPress={handleLoadingDemo} isDisabled={loading}>
                    {loading ? <ButtonSpinner /> : null}
                    <ButtonText>{loading ? "Loading…" : "Loading demo"}</ButtonText>
                  </Button>
                </ButtonGroup>
              </Box>
            </Box>
          </ShowcaseSection>

          <ShowcaseSection title="Inputs & Form controls">
            <Box className="flex-col gap-6">
              <FormControl>
                <FormControlLabel>
                  <FormControlLabelText>Default input</FormControlLabelText>
                </FormControlLabel>
                <Input>
                  <InputField
                    value={inputValue}
                    onChangeText={setInputValue}
                    placeholder="Type something…"
                  />
                </Input>
                <FormControlHelper>
                  <FormControlHelperText>
                    Helper text for additional context
                  </FormControlHelperText>
                </FormControlHelper>
              </FormControl>

              <FormControl isInvalid={showInputError}>
                <FormControlLabel>
                  <FormControlLabelText>Invalid input</FormControlLabelText>
                </FormControlLabel>
                <Input>
                  <InputField placeholder="Required field" />
                </Input>
                {showInputError ? (
                  <FormControlError>
                    <FormControlErrorText>This field is required</FormControlErrorText>
                  </FormControlError>
                ) : null}
              </FormControl>
              <Button
                variant="outline"
                onPress={() => setShowInputError((value) => !value)}
              >
                <ButtonText>
                  {showInputError ? "Clear error" : "Show error state"}
                </ButtonText>
              </Button>
            </Box>
          </ShowcaseSection>

          <ShowcaseSection title="Alerts">
            <Box className="flex-col gap-3">
              <Alert>
                <AlertText>Default alert — general information or tips.</AlertText>
              </Alert>
              <Alert variant="destructive">
                <AlertText>
                  Destructive alert — errors or actions that need attention.
                </AlertText>
              </Alert>
            </Box>
          </ShowcaseSection>

          <ShowcaseSection title="Toast">
            <Box className="flex-row flex-wrap gap-3">
              <Button variant="outline" onPress={() => showToast("success")}>
                <ButtonText>Success toast</ButtonText>
              </Button>
              <Button variant="outline" onPress={() => showToast("error")}>
                <ButtonText>Error toast</ButtonText>
              </Button>
              <Button variant="outline" onPress={() => showToast("muted")}>
                <ButtonText>Info toast</ButtonText>
              </Button>
            </Box>
          </ShowcaseSection>

          <ShowcaseSection title="Spinner, Divider, Pressable, Icon">
            <Box className="flex-col gap-6">
              <Box className="flex-row flex-wrap items-center gap-6">
                <Spinner size="small" />
                <Spinner size="large" />
              </Box>
              <Divider />
              <Pressable
                onPress={() => showToast("muted")}
                className="self-start rounded-lg border border-border bg-muted px-4 py-3"
              >
                <Text className="text-sm font-medium text-foreground">
                  Pressable — tap to trigger a toast
                </Text>
              </Pressable>
              <Box className="flex-row items-center gap-2">
                <CheckIcon className="h-5 w-5 text-success" />
                <Text className="text-sm text-muted-foreground">CheckIcon</Text>
              </Box>
            </Box>
          </ShowcaseSection>
        </Box>
      </ScrollView>
    </Screen>
  );
}
