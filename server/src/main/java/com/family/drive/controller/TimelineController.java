package com.family.drive.controller;

import com.family.drive.model.User;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.HashMap;

@RestController
@RequestMapping("/api/v1/timeline")
public class TimelineController {

    @GetMapping
    public ResponseEntity<List<Map<String, Object>>> getTimeline(@AuthenticationPrincipal User user) {
        // Mocking a grouped timeline response
        // In reality, this would query the DB for images and GROUP BY date derived from EXIF data.
        
        List<Map<String, Object>> mockTimeline = List.of(
            Map.of(
                "title", "Today",
                "data", List.of(
                    Map.of("id", 1, "url", "dummy-url-1", "type", "image/jpeg"),
                    Map.of("id", 2, "url", "dummy-url-2", "type", "image/jpeg")
                )
            ),
            Map.of(
                "title", "Yesterday",
                "data", List.of(
                    Map.of("id", 3, "url", "dummy-url-3", "type", "video/mp4")
                )
            )
        );

        return ResponseEntity.ok(mockTimeline);
    }
}
