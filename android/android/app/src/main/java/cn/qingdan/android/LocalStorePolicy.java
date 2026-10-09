package cn.qingdan.android;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Pure policy checks shared by the native store and host-independent tests. */
public final class LocalStorePolicy {
    public static final int MAX_OBJECT_BYTES = 25 * 1024 * 1024;
    private LocalStorePolicy() { }

    public static void validateObjectKey(String key) {
        if (key == null || key.isEmpty() || key.getBytes(StandardCharsets.UTF_8).length > 1024
                || key.startsWith("/") || key.indexOf('\\') >= 0) throw invalidKey();
        for (int i = 0; i < key.length(); i++) {
            char c = key.charAt(i);
            if (c < 32 || c == 127 || (Character.isSurrogate(c)
                    && (!Character.isHighSurrogate(c) || i + 1 >= key.length()
                    || !Character.isLowSurrogate(key.charAt(++i))))) throw invalidKey();
        }
        for (String part : key.split("/", -1)) {
            if (part.isEmpty() || part.equals(".") || part.equals("..")) throw invalidKey();
        }
    }

    private static IllegalArgumentException invalidKey() {
        return new IllegalArgumentException("Invalid object key.");
    }

    public static final class Sql {
        public final String statement;
        public final boolean hasRows;
        public final boolean returning;
        public final int parameters;
        private Sql(String statement, boolean hasRows, boolean returning, int parameters) {
            this.statement = statement; this.hasRows = hasRows;
            this.returning = returning; this.parameters = parameters;
        }
    }

    /** SQL is confined to business DML. No ATTACH, PRAGMA, transactions, schema or account access. */
    public static Sql inspectSql(String sql) {
        if (sql == null || sql.length() > 1024 * 1024) throw new IllegalArgumentException("SQL is too large.");
        List<String> statements = splitStatements(sql);
        if (statements.size() != 1) throw new IllegalArgumentException("Exactly one SQL statement is required.");
        String statement = statements.get(0);
        List<Token> tokens = tokens(statement);
        if (tokens.isEmpty()) throw new IllegalArgumentException("SQL is empty.");
        String command = "";
        boolean returning = false;
        int parameters = 0;
        for (Token token : tokens) {
            String word = token.text;
            if (word.startsWith("_qingdan_") || word.startsWith("auth_")
                    || word.startsWith("sqlite_") || word.startsWith("pragma_")
                    || word.equals("load_extension") || word.equals("readfile") || word.equals("writefile")) {
                throw new IllegalArgumentException("SQL cannot access protected storage or external files.");
            }
            if (!token.quoted && word.equals("?")) parameters++;
            if (token.depth == 0 && !token.quoted) {
                if (command.isEmpty() && !word.equals("with") && !word.equals("recursive")
                        && isCommand(word)) command = word;
                if (word.equals("returning")) returning = true;
            }
        }
        Token first = tokens.get(0);
        if (first.quoted || !(isCommand(first.text) || first.text.equals("with")) || command.isEmpty()) {
            throw new IllegalArgumentException("Only SELECT, INSERT, UPDATE and DELETE are supported.");
        }
        return new Sql(statement, command.equals("select") || returning, returning, parameters);
    }

    private static boolean isCommand(String word) {
        return word.equals("select") || word.equals("insert") || word.equals("update") || word.equals("delete");
    }

    /** Splits migration bytes without changing SQL; comments and quoted semicolons are preserved. */
    public static List<String> splitStatements(String sql) {
        if (sql == null || sql.indexOf('\0') >= 0) throw new IllegalArgumentException("Invalid SQL.");
        List<String> result = new ArrayList<>();
        int start = 0;
        for (int i = 0; i < sql.length(); i++) {
            char c = sql.charAt(i);
            if (c == '\'' || c == '"' || c == '`' || c == '[') {
                i = endQuote(sql, i);
            } else if (c == '-' && i + 1 < sql.length() && sql.charAt(i + 1) == '-') {
                i = endLine(sql, i);
            } else if (c == '/' && i + 1 < sql.length() && sql.charAt(i + 1) == '*') {
                i = endComment(sql, i);
            } else if (c == ';') {
                addStatement(result, sql.substring(start, i));
                start = i + 1;
            }
        }
        addStatement(result, sql.substring(start));
        return result;
    }

    private static void addStatement(List<String> result, String sql) {
        if (!tokens(sql).isEmpty()) result.add(sql.trim());
    }

    private static final class Token {
        final String text;
        final int depth;
        final boolean quoted;
        Token(String text, int depth, boolean quoted) {
            this.text = text.toLowerCase(Locale.ROOT); this.depth = depth; this.quoted = quoted;
        }
    }

    private static List<Token> tokens(String sql) {
        List<Token> result = new ArrayList<>();
        int depth = 0;
        for (int i = 0; i < sql.length(); i++) {
            char c = sql.charAt(i);
            // SQLite also accepts single-quoted table identifiers in FROM/UPDATE.
            // Inspect quoted contents for protected names, but never count them as syntax/bindings.
            if (c == '\'' || c == '"' || c == '`' || c == '[') {
                int end = endQuote(sql, i);
                String word = sql.substring(i + 1, end);
                if (c != '[') word = word.replace("" + c + c, "" + c);
                result.add(new Token(word, depth, true)); i = end; continue;
            }
            if (c == '-' && i + 1 < sql.length() && sql.charAt(i + 1) == '-') { i = endLine(sql, i); continue; }
            if (c == '/' && i + 1 < sql.length() && sql.charAt(i + 1) == '*') { i = endComment(sql, i); continue; }
            if (c == '(') { depth++; continue; }
            if (c == ')') { if (--depth < 0) throw new IllegalArgumentException("Unbalanced SQL."); continue; }
            if (c == '?') {
                if (i + 1 < sql.length() && Character.isDigit(sql.charAt(i + 1))) {
                    throw new IllegalArgumentException("Use anonymous SQL parameters.");
                }
                result.add(new Token("?", depth, false)); continue;
            }
            if (c == ':' || c == '@' || c == '$') throw new IllegalArgumentException("Use anonymous SQL parameters.");
            if (Character.isLetter(c) || c == '_') {
                int end = i + 1;
                while (end < sql.length() && (Character.isLetterOrDigit(sql.charAt(end))
                        || sql.charAt(end) == '_' || sql.charAt(end) == '$')) end++;
                result.add(new Token(sql.substring(i, end), depth, false)); i = end - 1;
            } else if (c < 32 && c != '\t' && c != '\n' && c != '\r') {
                throw new IllegalArgumentException("Invalid SQL control character.");
            }
        }
        if (depth != 0) throw new IllegalArgumentException("Unbalanced SQL.");
        return result;
    }

    private static int endQuote(String sql, int start) {
        char opener = sql.charAt(start), closer = opener == '[' ? ']' : opener;
        for (int i = start + 1; i < sql.length(); i++) {
            if (sql.charAt(i) == closer) {
                if (opener != '[' && i + 1 < sql.length() && sql.charAt(i + 1) == closer) { i++; continue; }
                return i;
            }
        }
        throw new IllegalArgumentException("Unterminated SQL quote.");
    }
    private static int endLine(String sql, int start) {
        int end = sql.indexOf('\n', start + 2);
        return end < 0 ? sql.length() - 1 : end;
    }
    private static int endComment(String sql, int start) {
        int end = sql.indexOf("*/", start + 2);
        if (end < 0) throw new IllegalArgumentException("Unterminated SQL comment.");
        return end + 1;
    }
}
