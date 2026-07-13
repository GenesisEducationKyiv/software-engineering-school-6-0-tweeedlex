export interface ReleaseEmailData {
  repo: string;
  tagName: string;
  releaseName: string | null;
  releaseUrl: string;
  publishedAt: string | null;
  unsubscribeUrl: string;
}

export function releaseEmailTemplate(data: ReleaseEmailData): string {
  const { repo, tagName, releaseName, releaseUrl, publishedAt, unsubscribeUrl } = data;
  const [owner, repoName] = repo.split('/');
  const displayName = releaseName || tagName;
  const publishedDate = publishedAt
    ? new Date(publishedAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Release: ${displayName}</title>
</head>
<body style="margin:0;padding:0;background:#f6f8fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8fa;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #d0d7de;border-radius:12px;overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="background:#24292f;padding:28px 40px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;padding-right:14px;">
                    <svg height="36" viewBox="0 0 16 16" width="36" style="fill:#ffffff;display:block;" aria-hidden="true">
                      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                    </svg>
                  </td>
                  <td style="vertical-align:middle;">
                    <p style="margin:0;font-size:12px;color:#8b949e;letter-spacing:0.04em;text-transform:uppercase;">New Release</p>
                    <p style="margin:2px 0 0;font-size:18px;font-weight:600;color:#ffffff;">
                      <span style="color:#8b949e;">${owner}&nbsp;/</span>&nbsp;${repoName}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Release info -->
          <tr>
            <td style="padding:32px 40px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8fa;border:1px solid #d0d7de;border-radius:8px;margin-bottom:28px;">
                <tr>
                  <td style="padding:20px 24px;">
                    <p style="margin:0 0 4px;font-size:12px;color:#57606a;text-transform:uppercase;letter-spacing:0.06em;">Release</p>
                    <p style="margin:0;font-size:22px;font-weight:700;color:#24292f;">${displayName}</p>
                    ${tagName !== displayName ? `<p style="margin:4px 0 0;font-size:14px;color:#57606a;">${tagName}</p>` : ''}
                    ${publishedDate ? `<p style="margin:8px 0 0;font-size:13px;color:#57606a;">${publishedDate}</p>` : ''}
                  </td>
                </tr>
              </table>

              <a href="${releaseUrl}" style="display:inline-block;background:#0969da;color:#ffffff;padding:12px 28px;border-radius:6px;text-decoration:none;font-size:15px;font-weight:600;letter-spacing:0.01em;">
                View Release on GitHub
              </a>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 40px;"><hr style="border:none;border-top:1px solid #d0d7de;margin:0;"></td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px;background:#f6f8fa;">
              <p style="margin:0;font-size:12px;color:#57606a;">
                You're receiving this because you subscribed to release notifications for <strong>${repo}</strong>.
                &nbsp;<a href="${unsubscribeUrl}" style="color:#57606a;text-decoration:underline;">Unsubscribe</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}
