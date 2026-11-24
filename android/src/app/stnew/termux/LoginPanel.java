package app.stnew.termux;

import android.app.Activity;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.graphics.drawable.StateListDrawable;
import android.os.Build;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

final class LoginPanel extends ScrollView {
    static final int TOP_COLOR = 0xffeee9f5;
    private static final int PAPER = 0xfff3eee4;
    private static final int SURFACE = 0xfffffdf9;
    private static final int INK = 0xff292341;
    private static final int MUTED = 0xff625a70;
    private static final int ACCENT = 0xff523c79;

    final EditText username;
    final EditText password;
    final Button submit;
    final Button back;
    private final TextView server;
    private final TextView error;

    LoginPanel(Activity activity) {
        super(activity);
        setFillViewport(true);
        setFocusableInTouchMode(true);
        setDescendantFocusability(FOCUS_BEFORE_DESCENDANTS);
        setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                new int[] {TOP_COLOR, PAPER, PAPER}));
        if (Build.VERSION.SDK_INT >= 26) {
            setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        }

        LinearLayout viewport = column();
        viewport.setGravity(Gravity.CENTER);
        viewport.setPadding(dp(20), dp(24), dp(20), dp(24));
        addView(viewport, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        LinearLayout content = new LinearLayout(activity) {
            @Override
            protected void onMeasure(int widthSpec, int heightSpec) {
                int width = Math.min(MeasureSpec.getSize(widthSpec), dp(400));
                super.onMeasure(MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY), heightSpec);
            }
        };
        content.setOrientation(LinearLayout.VERTICAL);
        viewport.addView(content, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));

        LinearLayout brand = new LinearLayout(activity);
        brand.setGravity(Gravity.CENTER);
        ImageView icon = new ImageView(activity);
        icon.setBackground(shape(INK, 12));
        icon.setClipToOutline(true);
        icon.setImageResource(activity.getApplicationInfo().icon);
        icon.setScaleType(ImageView.ScaleType.FIT_XY);
        icon.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        brand.addView(icon, new LinearLayout.LayoutParams(dp(44), dp(44)));
        TextView brandName = text("ST New", 21, INK);
        brandName.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        LinearLayout.LayoutParams brandNameParams = new LinearLayout.LayoutParams(
                LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT);
        brandNameParams.setMarginStart(dp(12));
        brand.addView(brandName, brandNameParams);
        add(content, brand, 0);

        LinearLayout card = column();
        card.setPadding(dp(20), dp(24), dp(20), dp(24));
        card.setBackground(outline(SURFACE, 22, 0xffded5df));
        add(content, card, 20);

        TextView title = text("登录 SillyTavern", 24, INK);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        if (Build.VERSION.SDK_INT >= 28) title.setAccessibilityHeading(true);
        add(card, title, 0);
        add(card, text("使用本机服务配置的账号和密码。", 14, MUTED), 6);

        username = field(card, "用户名",
                InputType.TYPE_TEXT_VARIATION_NORMAL | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS, 22);
        password = field(card, "密码", InputType.TYPE_TEXT_VARIATION_PASSWORD, 14);

        error = text("", 14, 0xff8a2e45);
        error.setPadding(dp(12), dp(10), dp(12), dp(10));
        error.setBackground(shape(0xfffaecee, 10));
        error.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        error.setVisibility(View.GONE);
        add(card, error, 14);

        submit = button("登录");
        submit.setTextColor(new ColorStateList(
                new int[][] {{-android.R.attr.state_enabled}, {}}, new int[] {INK, Color.WHITE}));
        StateListDrawable submitFill = new StateListDrawable();
        submitFill.addState(new int[] {-android.R.attr.state_enabled}, shape(0xffe9dff1, 10));
        submitFill.addState(new int[] {android.R.attr.state_focused}, outline(ACCENT, 10, Color.WHITE));
        submitFill.addState(new int[] {}, shape(ACCENT, 10));
        submit.setBackground(new RippleDrawable(ColorStateList.valueOf(0x30ffffff), submitFill, null));
        submit.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        add(card, submit, 18);

        server = text("", 13, MUTED);
        server.setGravity(Gravity.CENTER);
        server.setTypeface(Typeface.MONOSPACE);
        add(content, server, 20);
        back = button("返回连接设置");
        back.setTextColor(ACCENT);
        StateListDrawable backFill = new StateListDrawable();
        backFill.addState(new int[] {android.R.attr.state_focused}, outline(0xffeae2f2, 10, ACCENT));
        backFill.addState(new int[] {}, shape(Color.TRANSPARENT, 10));
        back.setBackground(new RippleDrawable(ColorStateList.valueOf(0x22523c79),
                backFill, shape(Color.WHITE, 10)));
        add(content, back, 2);
    }

    void showForm(String address, String failure, boolean switchingAccount) {
        server.setText(address);
        back.setText(switchingAccount ? "返回当前版本" : "返回连接设置");
        if (failure != null) {
            error.setVisibility(View.VISIBLE);
            error.setText(failure);
        } else {
            error.setVisibility(View.GONE);
        }
        submit.setText("登录");
        submit.setEnabled(true);
    }

    void showSubmitting() {
        error.setVisibility(View.GONE);
        submit.setText("正在登录…");
        submit.setEnabled(false);
    }

    private EditText field(LinearLayout parent, String title, int variation, int gap) {
        EditText input = new EditText(getContext());
        input.setId(View.generateViewId());
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT | variation);
        input.setSaveEnabled(false);
        input.setTextSize(16);
        input.setTextColor(INK);
        if (Build.VERSION.SDK_INT >= 29) {
            Drawable cursor = input.getTextCursorDrawable();
            if (cursor != null) {
                cursor = cursor.mutate();
                cursor.setTint(ACCENT);
                input.setTextCursorDrawable(cursor);
            }
        }
        input.setMinHeight(dp(48));
        input.setPaddingRelative(dp(12), dp(8), dp(12), dp(8));
        StateListDrawable fill = new StateListDrawable();
        fill.addState(new int[] {android.R.attr.state_focused}, outline(Color.WHITE, 10, ACCENT));
        fill.addState(new int[] {}, outline(0xfffaf8f6, 10, 0xff95889c));
        input.setBackground(fill);

        TextView label = text(title, 14, INK);
        label.setLabelFor(input.getId());
        add(parent, label, gap);
        add(parent, input, 6);
        return input;
    }

    private Button button(String title) {
        Button button = new Button(getContext());
        button.setText(title);
        button.setTextSize(16);
        button.setAllCaps(false);
        button.setMinHeight(dp(48));
        button.setPadding(dp(12), dp(8), dp(12), dp(8));
        button.setStateListAnimator(null);
        return button;
    }

    private TextView text(String value, int size, int color) {
        TextView view = new TextView(getContext());
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        return view;
    }

    private LinearLayout column() {
        LinearLayout layout = new LinearLayout(getContext());
        layout.setOrientation(LinearLayout.VERTICAL);
        return layout;
    }

    private void add(LinearLayout parent, View child, int top) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT);
        params.topMargin = dp(top);
        parent.addView(child, params);
    }

    private GradientDrawable shape(int color, int radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radius));
        return drawable;
    }

    private GradientDrawable outline(int color, int radius, int stroke) {
        GradientDrawable drawable = shape(color, radius);
        drawable.setStroke(dp(1), stroke);
        return drawable;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
