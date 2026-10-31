package com.bluemon7894.tmusic;

import android.content.Context;
import android.graphics.Rect;
import android.util.Log;
import android.view.ActionMode;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.webkit.WebView;

// An error while WebView builds its text menu (copy, paste) would otherwise take the whole app and the
// music with it, because it reaches native code uncaught. Losing the menu that one time is far better.
final class AppWebView extends WebView {
    private static final String TAG = "T-Music";

    AppWebView(Context context) {
        super(context);
    }

    @Override
    public ActionMode startActionMode(ActionMode.Callback callback) {
        return super.startActionMode(new SafeCallback(callback));
    }

    @Override
    public ActionMode startActionMode(ActionMode.Callback callback, int type) {
        return super.startActionMode(new SafeCallback(callback), type);
    }

    private static final class SafeCallback extends ActionMode.Callback2 {
        private final ActionMode.Callback inner;

        SafeCallback(ActionMode.Callback inner) {
            this.inner = inner;
        }

        @Override
        public boolean onCreateActionMode(ActionMode mode, Menu menu) {
            try {
                return inner.onCreateActionMode(mode, menu);
            } catch (RuntimeException e) {
                Log.w(TAG, "text menu could not be opened", e);
                return false;
            }
        }

        @Override
        public boolean onPrepareActionMode(ActionMode mode, Menu menu) {
            try {
                return inner.onPrepareActionMode(mode, menu);
            } catch (RuntimeException e) {
                Log.w(TAG, "text menu could not be prepared", e);
                return false;
            }
        }

        @Override
        public boolean onActionItemClicked(ActionMode mode, MenuItem item) {
            return inner.onActionItemClicked(mode, item);
        }

        @Override
        public void onDestroyActionMode(ActionMode mode) {
            inner.onDestroyActionMode(mode);
        }

        @Override
        public void onGetContentRect(ActionMode mode, View view, Rect outRect) {
            if (inner instanceof ActionMode.Callback2) ((ActionMode.Callback2) inner).onGetContentRect(mode, view, outRect);
            else super.onGetContentRect(mode, view, outRect);
        }
    }
}
