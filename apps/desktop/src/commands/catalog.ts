export interface LocalizedText {
  zh: string;
  en: string;
}

export interface CommandEntry {
  name: string;
  summary: LocalizedText;
  usage: string;
}

export interface CommandCategory {
  id: string;
  title: LocalizedText;
  commands: CommandEntry[];
}

function text(zh: string, en: string): LocalizedText {
  return { zh, en };
}

export const commandCatalog: CommandCategory[] = [
  {
    id: "files",
    title: text("文件与目录", "Files and directories"),
    commands: [
      { name: "pwd", summary: text("打印当前工作目录的绝对路径。", "Print the absolute path of the current directory."), usage: "pwd" },
      { name: "ls", summary: text("列出目录内容。-l 显示详情，-a 包含隐藏文件，-h 用可读大小。", "List directory contents. -l shows details, -a includes hidden files, and -h uses readable sizes."), usage: "ls -lah /var/log" },
      { name: "cd", summary: text("切换当前目录。单独使用时回到家目录，- 回到上一个目录。", "Change directory. Used alone, it returns home. - returns to the previous directory."), usage: "cd /etc\ncd -\ncd" },
      { name: "mkdir", summary: text("创建目录。-p 会一并创建尚不存在的父目录。", "Create a directory. -p also creates missing parent directories."), usage: "mkdir -p ~/work/logs" },
      { name: "cp", summary: text("复制文件或目录。复制目录时加上 -r。", "Copy a file or directory. Add -r when copying a directory."), usage: "cp app.conf app.conf.bak\ncp -r ./src ./src.bak" },
      { name: "mv", summary: text("移动或重命名文件和目录。", "Move or rename files and directories."), usage: "mv old.txt new.txt\nmv ./build /tmp/build" },
      { name: "rm", summary: text("删除文件。-r 递归删除目录，-f 不再逐个确认。删除前先核对路径。", "Delete files. -r removes a directory recursively, and -f skips confirmation. Check the path first."), usage: "rm ./tmp.log\nrm -rf ./build" },
      { name: "find", summary: text("按名称、类型或时间在目录树中查找。", "Search a directory tree by name, type, or time."), usage: "find . -name '*.log' -type f\nfind /var -mtime -1" },
      { name: "du", summary: text("统计目录占用的磁盘空间。-h 可读大小，-d 限制层级。", "Show disk space used by a directory. -h uses readable sizes, and -d limits depth."), usage: "du -h -d 1 ." },
      { name: "df", summary: text("查看文件系统的总容量、已用和可用空间。", "Show total, used, and available space on filesystems."), usage: "df -h" },
    ],
  },
  {
    id: "view",
    title: text("查看与搜索", "View and search"),
    commands: [
      { name: "cat", summary: text("把文件内容一次输出到终端，适合短文件。", "Print a file to the terminal. Best for short files."), usage: "cat /etc/os-release" },
      { name: "less", summary: text("分页查看长文件。空格翻页，/ 搜索，q 退出。", "Page through a long file. Space moves forward, / searches, and q quits."), usage: "less /var/log/syslog" },
      { name: "head", summary: text("查看文件开头。-n 指定行数。", "Show the start of a file. -n sets the line count."), usage: "head -n 20 access.log" },
      { name: "tail", summary: text("查看文件末尾。-f 持续跟随新写入的内容，常用于看日志。", "Show the end of a file. -f follows new writes and is often used for logs."), usage: "tail -n 50 app.log\ntail -f app.log" },
      { name: "grep", summary: text("在文本中搜索匹配行。-i 忽略大小写，-n 显示行号，-r 递归目录。", "Search text for matching lines. -i ignores case, -n shows line numbers, and -r searches directories."), usage: "grep -n 'error' app.log\ngrep -Rni 'timeout' ./src" },
      { name: "wc", summary: text("统计行数、单词数和字节数。-l 只计行，-w 计词，-c 计字节。", "Count lines, words, and bytes. -l counts lines, -w words, and -c bytes."), usage: "wc -l access.log\nwc -lwm report.txt" },
      { name: "sed", summary: text("按行编辑文本。s/旧/新/g 做替换，-n 配合 p 只打印指定行。-i.bak 会原地修改并留下备份。", "Edit text line by line. s/old/new/g replaces text. -n with p prints selected lines. -i.bak edits in place and keeps a backup."), usage: "sed -n '1,20p' app.log\nsed 's/old/new/g' config.yml\nsed -i.bak 's/127.0.0.1/0.0.0.0/' config.yml" },
      { name: "awk", summary: text("按列处理文本。默认以空白分列，$1 是第一列，-F 指定分隔符。", "Process text by columns. Whitespace splits fields by default, $1 is the first column, and -F sets the separator."), usage: "awk '{print $1, $3}' access.log\nawk -F: '{print $1}' /etc/passwd\nawk '$3 > 100 {print $1}' usage.txt" },
      { name: "cut", summary: text("按分隔符或字符位置截取列。-d 指定分隔符，-f 选择字段。", "Cut columns by separator or character position. -d sets the separator, and -f selects fields."), usage: "cut -d: -f1 /etc/passwd\ncut -c1-8 ids.txt" },
      { name: "sort", summary: text("排序文本行。-n 按数值，-k 指定列，-r 倒序，-u 去掉重复行。", "Sort lines. -n sorts numerically, -k chooses a column, -r reverses, and -u drops duplicates."), usage: "sort names.txt\nsort -n -k2 scores.txt\nsort -u names.txt" },
      { name: "uniq", summary: text("合并相邻的重复行。-c 显示出现次数，-d 只保留重复行。统计前通常先 sort。", "Collapse adjacent duplicate lines. -c shows counts, and -d keeps only duplicates. Sort first when counting."), usage: "sort access.log | uniq -c\nuniq -d names.txt" },
      { name: "xargs", summary: text("把上一命令的输出变成下一命令的参数。-I{} 用占位符逐条替换。", "Turn the previous command's output into arguments. -I{} replaces a placeholder once per item."), usage: "find . -name '*.log' | xargs grep -l error\nls *.txt | xargs -I{} cp {} /tmp/" },
    ],
  },
  {
    id: "process",
    title: text("权限与进程", "Permissions and processes"),
    commands: [
      { name: "sudo", summary: text("以其他用户执行一条命令，默认是 root。-u 指定用户，-i 进入该用户的登录 shell。", "Run a command as another user, root by default. -u chooses the user, and -i opens that user's login shell."), usage: "sudo systemctl restart nginx\nsudo -u www-data ls /var/www\nsudo -i" },
      { name: "su", summary: text("切换到另一个用户。加上 - 会加载目标用户的登录环境，不写用户名时切到 root。", "Switch to another user. - loads that user's login environment. With no name, it switches to root."), usage: "su -\nsu - postgres" },
      { name: "id", summary: text("显示用户的 uid、主组和附加组。不带参数时查看当前用户。", "Show a user's uid, primary group, and extra groups. With no arguments, it shows the current user."), usage: "id\nid www-data" },
      { name: "whoami", summary: text("打印当前有效用户名，用来确认 sudo 之后实际是谁。", "Print the current effective username. Useful after sudo."), usage: "whoami\nsudo whoami" },
      { name: "chmod", summary: text("修改文件权限。常见写法是所有者、组、其他人的读(4)写(2)执行(1)。", "Change file permissions. A common form is read (4), write (2), and execute (1) for owner, group, and others."), usage: "chmod 644 config.yml\nchmod +x ./script.sh" },
      { name: "chown", summary: text("修改文件的所有者和所属组。", "Change a file's owner and group."), usage: "chown user:staff ./data\nsudo chown -R www-data:www-data /var/www" },
      { name: "ps", summary: text("查看进程。aux 列出全部进程及资源占用，-ef 显示完整命令行和父进程，-p 只看指定 PID。", "List processes. aux shows every process and its resource use, -ef shows the full command and parent, and -p selects a PID."), usage: "ps aux\nps -ef | grep nginx\nps -p 1234 -o pid,user,%cpu,%mem,cmd" },
      { name: "top", summary: text("实时查看进程的 CPU 和内存。q 退出，P 按 CPU 排序，M 按内存排序。", "Watch CPU and memory live. q quits, P sorts by CPU, and M sorts by memory."), usage: "top\ntop -p 1234 -u www-data" },
      { name: "pstree", summary: text("以树形显示进程的父子关系。-p 附带 PID。", "Show parent and child processes as a tree. -p includes PIDs."), usage: "pstree -p\npstree -p 1234" },
      { name: "pgrep", summary: text("按名称查找进程并打印 PID。-a 同时显示命令行，-u 限定用户，-f 匹配完整命令。", "Find processes by name and print their PIDs. -a also shows the command, -u limits the user, and -f matches the full command."), usage: "pgrep -a nginx\npgrep -u www-data -af 'python app.py'" },
      { name: "pkill", summary: text("按名称给进程发信号。-f 匹配完整命令行。先用 pgrep 确认目标再执行。", "Signal processes by name. -f matches the full command line. Confirm with pgrep first."), usage: "pkill nginx\npkill -9 -f 'python app.py'" },
      { name: "kill", summary: text("按 PID 发送信号。默认是终止，-9 强制结束，-15 是可捕获的正常退出。", "Send a signal by PID. The default terminates the process, -9 forces it, and -15 asks it to exit."), usage: "kill 1234\nkill -15 1234\nkill -9 1234" },
      { name: "killall", summary: text("按进程名结束所有同名进程。名称必须与进程名一致，不是完整命令行。", "Stop every process with a given name. The name must match the process name, not the full command line."), usage: "killall nginx\nkillall -9 python" },
      { name: "nohup", summary: text("终端关闭后命令仍继续运行。把标准输出和错误重定向到日志，末尾 & 放到后台。", "Keep a command running after the terminal closes. Redirect stdout and stderr to a log, and end with & to background it."), usage: "nohup ./server.sh > server.log 2>&1 &" },
      { name: "lsof", summary: text("查看进程打开的文件和占用的端口。-i 按端口或协议，-p 按 PID。", "Show files and ports a process has open. -i filters by port or protocol, and -p filters by PID."), usage: "lsof -i :80\nlsof -p 1234" },
    ],
  },
  {
    id: "net",
    title: text("压缩与网络", "Archives and network"),
    commands: [
      { name: "tar", summary: text("打包或解包。-c 创建，-x 解包，-z 使用 gzip，-v 显示过程，-f 指定文件。", "Create or extract an archive. -c creates, -x extracts, -z uses gzip, -v shows progress, and -f names the file."), usage: "tar -czvf backup.tar.gz ./data\ntar -xzvf backup.tar.gz" },
      { name: "curl", summary: text("发起 HTTP 请求。-I 只看响应头，-o 保存到文件，-L 跟随跳转。", "Make an HTTP request. -I shows headers, -o saves to a file, and -L follows redirects."), usage: "curl -I https://example.com\ncurl -L -o file.tar.gz https://example.com/file.tar.gz" },
      { name: "ping", summary: text("测试到主机的连通性和往返时间。-c 限制次数。", "Test whether a host answers and how long the round trip takes. -c limits the count."), usage: "ping -c 4 example.com" },
      { name: "ss", summary: text("查看套接字和监听端口。-l 只看监听，-n 不解析服务名，-t 只看 TCP。", "Show sockets and listening ports. -l shows listeners, -n skips service names, and -t shows TCP."), usage: "ss -lnt\nss -lntup" },
    ],
  },
  {
    id: "docker",
    title: text("Docker", "Docker"),
    commands: [
      { name: "docker ps", summary: text("列出容器。默认只显示运行中的，-a 包含已停止的容器。", "List containers. Running ones are shown by default. -a includes stopped containers."), usage: "docker ps\ndocker ps -a" },
      { name: "docker images", summary: text("列出本机镜像，包括仓库、标签和大小。", "List local images, including repository, tag, and size."), usage: "docker images" },
      { name: "docker pull", summary: text("从仓库拉取镜像。标签不写时默认是 latest。", "Pull an image. The tag defaults to latest."), usage: "docker pull nginx:1.27" },
      { name: "docker run", summary: text("用镜像创建并启动容器。-d 后台运行，--name 指定名字，-p 映射端口，-it 打开交互终端，--rm 退出后删除。", "Create and start a container. -d runs it in the background, --name sets the name, -p maps a port, -it opens a terminal, and --rm deletes it on exit."), usage: "docker run -d --name web -p 8080:80 nginx:1.27\ndocker run -it --rm alpine sh" },
      { name: "docker exec", summary: text("在运行中的容器里执行命令。-it 配合 sh 可以进入容器终端。", "Run a command in a running container. -it with sh opens a shell inside it."), usage: "docker exec -it web sh\ndocker exec web nginx -t" },
      { name: "docker logs", summary: text("查看容器输出。--tail 只看末尾若干行，-f 持续跟随。", "Show container output. --tail limits the end, and -f follows new lines."), usage: "docker logs --tail 100 web\ndocker logs -f web" },
      { name: "docker stop", summary: text("停止、启动或重启容器。stop 会先发正常退出信号，超时后再强制结束。", "Stop, start, or restart a container. stop asks it to exit, then forces it after a timeout."), usage: "docker stop web\ndocker start web\ndocker restart web" },
      { name: "docker rm", summary: text("删除容器。容器需先停止；-f 会强制停止后再删除。", "Remove a container. Stop it first. -f forces a stop, then removes it."), usage: "docker rm web\ndocker rm -f web" },
      { name: "docker compose", summary: text("按 compose 文件管理一组容器。up -d 后台启动，ps 看状态，logs -f 跟随日志，down 停止并移除这组容器。", "Manage a group of containers from a compose file. up -d starts them in the background, ps shows status, logs -f follows logs, and down stops and removes the group."), usage: "docker compose up -d\ndocker compose ps\ndocker compose logs -f web\ndocker compose down" },
    ],
  },
  {
    id: "system",
    title: text("系统", "System"),
    commands: [
      { name: "uname", summary: text("显示内核与系统信息。-a 输出全部字段。", "Show kernel and system information. -a prints every field."), usage: "uname -a" },
      { name: "free", summary: text("查看内存和交换空间。-h 使用可读单位。", "Show memory and swap. -h uses readable units."), usage: "free -h" },
      { name: "systemctl", summary: text("管理 systemd 服务。status 看状态，start / stop / restart 控制运行，enable --now 立即启动并设为开机自启，daemon-reload 在改完 unit 文件后重新加载。", "Manage systemd services. status shows state. start, stop, and restart control it. enable --now starts it and enables boot. daemon-reload reloads unit files."), usage: "systemctl status nginx\nsudo systemctl start nginx\nsudo systemctl stop nginx\nsudo systemctl restart nginx\nsudo systemctl enable --now nginx\nsudo systemctl disable nginx\nsystemctl list-units --type=service\nsudo systemctl daemon-reload" },
      { name: "crontab", summary: text("管理当前用户的定时任务。-l 列出，-e 编辑，-r 删除全部。一行的前五段是分、时、日、月、周。", "Manage the current user's scheduled jobs. -l lists them, -e edits them, and -r deletes them. The first five fields are minute, hour, day, month, and weekday."), usage: "crontab -l\ncrontab -e\n# 每 5 分钟执行一次\n*/5 * * * * /usr/local/bin/backup.sh" },
      { name: "journalctl", summary: text("查看 systemd 日志。-u 指定服务，-n 限制行数，-f 持续跟随，--since 限定时间，-p 按优先级，-b 只看本次启动，-k 只看内核。", "Read systemd logs. -u selects a service, -n limits lines, -f follows, --since sets a start time, -p filters priority, -b shows this boot, and -k shows the kernel."), usage: "journalctl -u nginx -n 100\njournalctl -u nginx -f\njournalctl -u nginx --since \"1 hour ago\"\njournalctl -p err -b\njournalctl -k -n 50" },
    ],
  },
];
