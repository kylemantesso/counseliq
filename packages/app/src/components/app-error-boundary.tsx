'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Box, Button, ButtonText, Text } from '@app-template/ui';
import { getUserFacingErrorMessage } from '../auth/errors';

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
};

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // console.error triggers the Next.js dev overlay; warn keeps real errors visible in UI.
    console.warn('AppErrorBoundary caught an error:', error.message, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <Box className="flex-1 flex-col items-center justify-center bg-background p-6">
          <Text className="text-xl font-bold text-foreground mb-2">
            Something went wrong
          </Text>
          <Text className="text-muted-foreground mb-6 text-center">
            {getUserFacingErrorMessage(this.state.error)}
          </Text>
          {process.env.NODE_ENV === 'development' ? (
            <Text className="text-muted-foreground mb-6 text-center text-xs">
              {this.state.error.message}
            </Text>
          ) : null}
          <Button variant="default" onPress={this.handleRetry}>
            <ButtonText>Try again</ButtonText>
          </Button>
        </Box>
      );
    }

    return this.props.children;
  }
}
