#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>

#include "bindings/bindings.h"

// Mirrors Android WebViewInsets: publish native keyboard geometry so the web
// layer can hide the bottom navigation and shrink the layout viewport without
// guessing visibility from input focus.
static id MftpKeyboardChangeObserver = nil;
static id MftpKeyboardHideObserver = nil;

static UIWindow *MftpActiveWindow(void) {
  if (@available(iOS 13.0, *)) {
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
      if (![scene isKindOfClass:[UIWindowScene class]]) {
        continue;
      }
      for (UIWindow *window in ((UIWindowScene *)scene).windows) {
        if (window.isKeyWindow) {
          return window;
        }
      }
    }
  }
  return UIApplication.sharedApplication.keyWindow;
}

static WKWebView *MftpFindWebView(UIView *view) {
  if ([view isKindOfClass:[WKWebView class]]) {
    return (WKWebView *)view;
  }
  for (UIView *child in view.subviews) {
    WKWebView *found = MftpFindWebView(child);
    if (found) {
      return found;
    }
  }
  return nil;
}

static void MftpApplyKeyboardState(BOOL visible, CGFloat overlap) {
  UIWindow *window = MftpActiveWindow();
  if (!window) {
    return;
  }
  WKWebView *webView = MftpFindWebView(window.rootViewController.view);
  if (!webView) {
    return;
  }

  NSString *script;
  if (visible) {
    // Points and CSS pixels match on iOS; do not divide by screen scale.
    CGFloat available = MAX(0, window.bounds.size.height - overlap);
    script = [NSString
        stringWithFormat:@"(()=>{const r=document.documentElement;if(!r)return;"
                         "r.dataset.imeVisible='true';"
                         "r.style.setProperty('--native-viewport-height','%.2fpx');"
                         "r.style.setProperty('--safe-bottom','0px');})()",
                         available];
  } else {
    // Removing the inline values restores 100dvh and env(safe-area-inset-*).
    script = @"(()=>{const r=document.documentElement;if(!r)return;"
              "r.dataset.imeVisible='false';"
              "r.style.removeProperty('--native-viewport-height');"
              "r.style.removeProperty('--safe-bottom');})()";
  }
  [webView evaluateJavaScript:script completionHandler:nil];
}

static void MftpInstallKeyboardObservers(void) {
  NSNotificationCenter *center = [NSNotificationCenter defaultCenter];
  MftpKeyboardChangeObserver = [center
      addObserverForName:UIKeyboardWillChangeFrameNotification
                  object:nil
                   queue:[NSOperationQueue mainQueue]
              usingBlock:^(NSNotification *note) {
                UIWindow *window = MftpActiveWindow();
                if (!window) {
                  return;
                }
                CGRect endFrame =
                    [note.userInfo[UIKeyboardFrameEndUserInfoKey] CGRectValue];
                CGRect inWindow =
                    [window convertRect:endFrame
                    fromCoordinateSpace:window.screen.coordinateSpace];
                CGRect overlap = CGRectIntersection(window.bounds, inWindow);
                CGFloat height =
                    CGRectIsNull(overlap) ? 0 : CGRectGetHeight(overlap);
                MftpApplyKeyboardState(height > 1, height);
              }];
  MftpKeyboardHideObserver =
      [center addObserverForName:UIKeyboardWillHideNotification
                          object:nil
                           queue:[NSOperationQueue mainQueue]
                      usingBlock:^(NSNotification *note) {
                        MftpApplyKeyboardState(NO, 0);
                      }];
}

int main(int argc, char * argv[]) {
	MftpInstallKeyboardObservers();
	ffi::start_app();
	return 0;
}
