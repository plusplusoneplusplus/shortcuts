use reqwest::{header::HeaderMap, Method};
use std::time::Duration;
use teams_sdk::{
    http::{HttpRequest, HttpTransport, ReqwestTransport, MAX_RESPONSE_BYTES},
    ErrorCode,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

#[tokio::test]
async fn native_http_never_redirects_or_retries_server_errors() {
    for status in ["302 Found", "503 Service Unavailable"] {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let address = listener.local_addr().unwrap();
        let reply = format!("HTTP/1.1 {status}\r\nLocation: http://{address}/redirected\r\nContent-Length: 12\r\nConnection: close\r\n\r\nprivate-body");
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0u8; 4096];
            assert!(socket.read(&mut request).await.unwrap() > 0);
            socket.write_all(reply.as_bytes()).await.unwrap();
            drop(socket);
            assert!(
                tokio::time::timeout(Duration::from_millis(50), listener.accept())
                    .await
                    .is_err()
            );
        });
        let response = ReqwestTransport::new()
            .unwrap()
            .execute(HttpRequest {
                method: Method::POST,
                url: format!("http://{address}/initial").parse().unwrap(),
                headers: HeaderMap::new(),
                body: Some(b"synthetic".to_vec()),
            })
            .await
            .unwrap();
        assert!(response.body.is_empty());
        assert_eq!(response.status, status[..3].parse::<u16>().unwrap());
        server.await.unwrap();
    }
}

#[tokio::test]
async fn native_http_rejects_oversized_success_before_reading_body() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = [0u8; 4096];
        assert!(socket.read(&mut request).await.unwrap() > 0);
        socket
            .write_all(
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    MAX_RESPONSE_BYTES + 1
                )
                .as_bytes(),
            )
            .await
            .unwrap();
    });
    let result = ReqwestTransport::new()
        .unwrap()
        .execute(HttpRequest {
            method: Method::GET,
            url: format!("http://{address}/bounded").parse().unwrap(),
            headers: HeaderMap::new(),
            body: None,
        })
        .await;
    assert_eq!(result.err().unwrap().code, ErrorCode::Limit);
    server.await.unwrap();
}
