<?xml version="1.0"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="html" indent="yes"/>

<xsl:template match="/">
<html>
<head>
  <title>RTMP Stats — HappyDo Guard</title>
  <meta http-equiv="refresh" content="5"/>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; background: #f5f5f5; color: #333; padding: 1.5rem; }
    h1 { font-size: 1.4rem; color: #1a1a2e; margin-bottom: 0.25rem; }
    .subtitle { color: #666; font-size: 0.85rem; margin-bottom: 1.5rem; }
    .cards { display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.5rem; }
    .card { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 1rem 1.25rem; min-width: 140px; }
    .card-label { font-size: 0.75rem; color: #999; text-transform: uppercase; letter-spacing: 0.5px; }
    .card-value { font-size: 1.5rem; font-weight: 700; color: #1a1a2e; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; border: 1px solid #ddd; }
    th { background: #1a1a2e; color: #fff; padding: 0.75rem 1rem; text-align: left; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.5px; }
    td { padding: 0.75rem 1rem; border-bottom: 1px solid #eee; font-size: 0.875rem; }
    tr:last-child td { border-bottom: none; }
    .online { color: #2e7d32; font-weight: 600; }
    .offline { color: #999; }
    .bw { font-family: monospace; }
    .section { margin-bottom: 1.5rem; }
    .section h2 { font-size: 1.1rem; color: #1a1a2e; margin-bottom: 0.75rem; }
    .empty { text-align: center; padding: 2rem; color: #999; }
  </style>
</head>
<body>
  <h1>HappyDo Guard — RTMP Stats</h1>
  <p class="subtitle">
    Nginx <xsl:value-of select="rtmp/nginx_version"/> |
    RTMP Module <xsl:value-of select="rtmp/nginx_rtmp_version"/> |
    Uptime: <xsl:call-template name="uptime"><xsl:with-param name="sec" select="rtmp/uptime"/></xsl:call-template> |
    Auto-refresh: 5s
  </p>

  <div class="cards">
    <div class="card">
      <div class="card-label">Conexões</div>
      <div class="card-value"><xsl:value-of select="rtmp/naccepted"/></div>
    </div>
    <div class="card">
      <div class="card-label">BW In</div>
      <div class="card-value bw"><xsl:call-template name="bandwidth"><xsl:with-param name="bw" select="rtmp/bw_in"/></xsl:call-template></div>
    </div>
    <div class="card">
      <div class="card-label">BW Out</div>
      <div class="card-value bw"><xsl:call-template name="bandwidth"><xsl:with-param name="bw" select="rtmp/bw_out"/></xsl:call-template></div>
    </div>
    <div class="card">
      <div class="card-label">Bytes In</div>
      <div class="card-value bw"><xsl:call-template name="bytes"><xsl:with-param name="b" select="rtmp/bytes_in"/></xsl:call-template></div>
    </div>
    <div class="card">
      <div class="card-label">Bytes Out</div>
      <div class="card-value bw"><xsl:call-template name="bytes"><xsl:with-param name="b" select="rtmp/bytes_out"/></xsl:call-template></div>
    </div>
  </div>

  <xsl:for-each select="rtmp/server/application">
    <div class="section">
      <h2>Application: <xsl:value-of select="name"/></h2>

      <xsl:choose>
        <xsl:when test="live/stream">
          <table>
            <thead>
              <tr>
                <th>Stream</th>
                <th>Clients</th>
                <th>BW In</th>
                <th>BW Out</th>
                <th>Video</th>
                <th>Audio</th>
                <th>Uptime</th>
              </tr>
            </thead>
            <tbody>
              <xsl:for-each select="live/stream">
                <tr>
                  <td class="online"><xsl:value-of select="name"/></td>
                  <td><xsl:value-of select="nclients"/></td>
                  <td class="bw"><xsl:call-template name="bandwidth"><xsl:with-param name="bw" select="bw_in"/></xsl:call-template></td>
                  <td class="bw"><xsl:call-template name="bandwidth"><xsl:with-param name="bw" select="bw_out"/></xsl:call-template></td>
                  <td>
                    <xsl:if test="meta/video">
                      <xsl:value-of select="meta/video/width"/>x<xsl:value-of select="meta/video/height"/>
                      <xsl:text> </xsl:text>
                      <xsl:value-of select="meta/video/frame_rate"/>fps
                      <xsl:text> </xsl:text>
                      <xsl:value-of select="meta/video/codec"/>
                    </xsl:if>
                  </td>
                  <td>
                    <xsl:if test="meta/audio">
                      <xsl:value-of select="meta/audio/codec"/>
                      <xsl:text> </xsl:text>
                      <xsl:value-of select="meta/audio/sample_rate"/>Hz
                    </xsl:if>
                  </td>
                  <td><xsl:call-template name="uptime"><xsl:with-param name="sec" select="time div 1000"/></xsl:call-template></td>
                </tr>
              </xsl:for-each>
            </tbody>
          </table>
        </xsl:when>
        <xsl:otherwise>
          <div class="empty">Nenhum stream ativo</div>
        </xsl:otherwise>
      </xsl:choose>
    </div>
  </xsl:for-each>

</body>
</html>
</xsl:template>

<xsl:template name="uptime">
  <xsl:param name="sec"/>
  <xsl:variable name="days" select="floor($sec div 86400)"/>
  <xsl:variable name="hours" select="floor(($sec mod 86400) div 3600)"/>
  <xsl:variable name="minutes" select="floor(($sec mod 3600) div 60)"/>
  <xsl:variable name="seconds" select="$sec mod 60"/>
  <xsl:if test="$days > 0"><xsl:value-of select="$days"/>d </xsl:if>
  <xsl:value-of select="format-number($hours,'00')"/>:<xsl:value-of select="format-number($minutes,'00')"/>:<xsl:value-of select="format-number($seconds,'00')"/>
</xsl:template>

<xsl:template name="bandwidth">
  <xsl:param name="bw"/>
  <xsl:choose>
    <xsl:when test="$bw >= 1048576"><xsl:value-of select="format-number($bw div 1048576,'#.##')"/> Mbps</xsl:when>
    <xsl:when test="$bw >= 1024"><xsl:value-of select="format-number($bw div 1024,'#.##')"/> Kbps</xsl:when>
    <xsl:otherwise><xsl:value-of select="$bw"/> bps</xsl:otherwise>
  </xsl:choose>
</xsl:template>

<xsl:template name="bytes">
  <xsl:param name="b"/>
  <xsl:choose>
    <xsl:when test="$b >= 1073741824"><xsl:value-of select="format-number($b div 1073741824,'#.##')"/> GB</xsl:when>
    <xsl:when test="$b >= 1048576"><xsl:value-of select="format-number($b div 1048576,'#.##')"/> MB</xsl:when>
    <xsl:when test="$b >= 1024"><xsl:value-of select="format-number($b div 1024,'#.##')"/> KB</xsl:when>
    <xsl:otherwise><xsl:value-of select="$b"/> B</xsl:otherwise>
  </xsl:choose>
</xsl:template>

</xsl:stylesheet>
